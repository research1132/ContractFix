const appRoot = require("app-root-path");
const parser = require(appRoot + "/src/solidity-parser-antlr/src/index");
const transformer = require(appRoot + "/src/ast-transformer");

let DFG = {
    graph: {},
    builtinVars: ["msg", "this", "block", "abi", "now"],
    allParentContracts: [],
    thisContract: null,
    stateVars: {},
    localVars: {},
    varReferences: {},

    scanStateVars: (ast, contractName) => {
        var vars = {};
        var contracts = transformer.findNodeByName(ast, contractName);
        //scan the state vars in this contract
        for(let index in contracts){
            if(contracts[index].type == "ContractDefinition"){
                var contractNode = contracts[index];
                parser.visit(contracts[index], {
                    VariableDeclaration: node => {
                        if(node.isStateVar){
                            let varType = [];
                            varType.push(DFG.handleNode(node.typeName));
                            varType.push(node.isStateVar);
                            varType.push("storage");
                            vars[node.name] = varType;
                        }
                    },
                    EnumDefinition: node => {
                        if(node.depth == contracts[index].depth + 1)
                            vars[node.name] = [node.type, true, "storage"];
                    },
                    StructDefinition: node => {
                        if(node.depth == contracts[index].depth + 1){
                            let structMembers = {};
                            for(let x in node.members){
                                if(node.members[x].type == "VariableDeclaration"){
                                    structMembers[node.members[x].name] = DFG.handleNode(node.members[x].typeName);
                                }
                            }
                            vars[node.name] = [node.type, true, "storage", structMembers];
                        }
                    }
                })
                break;
            }
        }
        //find state vars in its parent contracts
        var parentContracts = [];
        for(let index in contractNode.baseContracts){
            contracts = transformer.findNodeByName(ast, contractNode.baseContracts[index].baseName.namePath);
            for(let i in contracts){
                if(contracts[i].type == "ContractDefinition"){
                    parentContracts.push(contracts[i]);
                    break;
                }
            }
        }
        for(let index in parentContracts){
            vars = Object.assign(vars, DFG.scanStateVars(ast, parentContracts[index].name));
            if(DFG.allParentContracts.indexOf(parentContracts[index]) == -1){
                DFG.allParentContracts.push(parentContracts[index]);
            }
        }
        //add built-in vars
        for(let index in DFG.builtinVars){
            let varType = ["built-in", true, "storage"];
            vars[DFG.builtinVars[index]] = varType;
        }
        //add library and contracts
        var libs = transformer.findNodeByType(ast, "ContractDefinition");
        for(let index in libs){
            if(libs[index].kind == "library"){
                vars[libs[index].name] = ["library", true, "storage"];
            }
            else if(libs[index].kind == "contract"){
                vars[libs[index].name] = ["contract", true, "storage"];
            }
        }
        DFG.stateVars = vars;
        return vars;
    },

    handleNode: (node) => {
        var newNode = null;
        if(node instanceof Object){
            newNode = transformer.cloneNode(node);
            parser.visit(newNode, {
                PrevAll: (n) => {
                    if(n.id != undefined){
                        delete n["id"];
                    }
                    if(n.range != undefined){
                        delete n["range"];
                    }
                    if(n.depth != undefined){
                        delete n["depth"];
                    }
                    if(n.loc != undefined){
                        delete n["loc"];
                    }
                    if(n.modified != undefined){
                        delete n["modified"];
                    }
                }
            })
        }
        else{
            newNode = node;
        }
        return newNode;
    },

    generate: (ast, funcNode) => {
        if(funcNode == null || funcNode.type != "FunctionDefinition"){
            console.log("Please input a function definition node.");
            return -1;
        }
        DFG.graph = {};
        DFG.allParentContracts = [];
        DFG.thisContract = null;
        var curBlockId = 0;
        var curCondition = null;
        var multiFlow = false;
        var multiBlockIds = {};
        var contracts = transformer.findNodeByType(ast, "ContractDefinition");
        var protection = [];
        for(let index in contracts){
            for(let i in contracts[index].subNodes){
                if(contracts[index].subNodes[i] == funcNode){
                    var contract = contracts[index];
                    DFG.thisContract = contracts[index];
                    break;
                }
            }
        }
        var stateVars = DFG.scanStateVars(ast, contract.name);
        let addFuncParameters = (funcNode, stateVars) => {
            if(funcNode.parameters.type != "ParameterList"){
                return stateVars;
            }
            for(let index in funcNode.parameters.parameters){
                let varType = [DFG.handleNode(funcNode.parameters.parameters[index].typeName), true, "memory"];
                stateVars[funcNode.parameters.parameters[index].name] = varType;
            }
            return stateVars;
        }
        stateVars = addFuncParameters(funcNode, stateVars);
        var localVars = {};
        var varReferences = [];
        var modifierParameters = {};
        let reverseCondition = (conditionNode) => {
            var newNode = transformer.createNode("UnaryOperation");
            transformer.setProperty(newNode, ["operator", "subExpression"], ["!", conditionNode]);
            return newNode;
        }
        let initStatement= (statementId) => {
            DFG.graph[statementId] = {
                "statementType": null,
                "prevBlocks": {},
                "postBlocks": {},
                "inputVars": {},
                "outputVars": {},
                "createVars": {},
                "deleteVars": {},
                "readVars": {},
                "assignVars": {},
                "noopVars": {}
            }
        }
        let checkLocation = (node) => {
            if(node == null)
                return null
            let res = null;
            let name = null;
            let curNode = node;
            let idSequence = [];
            let finalType = null;
            let type = null;
            let accesses = [];
            while(curNode != undefined && curNode != null){
                name = null;
                if(curNode.type == "IndexAccess"){
                    idSequence.push("index");
                    if(curNode.base.type != "Identifier"){
                        curNode = curNode.base;
                    }
                    else{
                        name = curNode.base.name;
                        break;
                    }
                }
                else if(curNode.type == "MemberAccess"){
                    idSequence.push("access");
                    accesses.push(curNode.memberName);
                    if(curNode.expression.type != "Identifier"){
                        curNode = curNode.expression;
                    }
                    else{
                        name = curNode.expression.name;
                        break;
                    }
                }
                else if(curNode.type == "Identifier"){
                    name = curNode.name;
                    break;
                }
                else{
                    name = null;
                    break;
                }
            }
            if(stateVars[name] != undefined && stateVars[name].length >= 3){
                finalType = stateVars[name];
            }
            else if(localVars[name] != undefined && localVars[name].length >= 3){
                finalType = localVars[name];
            }
            else{
                finalType = null;
            }
            if(finalType != null){
                type = finalType[0];
                for(let i = idSequence.length - 1; i >= 0; i--){
                    if(idSequence[i] == "index" && type != null){
                        if(type.type == "Mapping"){
                            type = type.valueType;
                        }
                        else if(type.type == "ArrayTypeName"){
                            type = type.baseTypeName;
                        }
                    }
                    else if(idSequence[i] == "access" && type != null){
                        if(type.type == "UserDefinedTypeName"){
                            if(stateVars[type.name] != undefined && stateVars[type.name][0] == "StructDefinition"){
                                type = stateVars[type.name][3][accesses[accesses.length - 1]];
                                accesses.splice(accesses.length - 1, 1);
                            }
                            else if(localVars[type.name] != undefined && localVars[type.name][0] == "StructDefinition"){
                                type = stateVars[type.name][3][accesses[accesses.length - 1]];
                                accesses.splice(accesses.length - 1, 1);
                            }
                        }
                        else{
                            type = null;
                            break;
                        }
                    }
                    else if(type == null){
                        break;
                    }
                }
            }
            if(type != null && type.type == "UserDefinedTypeName" && 
            ((stateVars[type.namePath] != undefined && stateVars[type.namePath][0] == "StructDefinition") 
            || (localVars[type.namePath] != undefined && localVars[type.namePath][0] == "StructDefinition" ))){
                return [name, finalType];
            }
            else if(type != null && type.type == "ArrayTypeName"){
                return [name, finalType];
            }
            else{
                return null;
            }
        }
        let addAssignVars= (blockId, name) => {
            for(let index in varReferences){
                if(varReferences[index][name] != undefined){
                    for(let i in varReferences[index]){
                        DFG.graph[blockId]["assignVars"][i] = varReferences[index][i];
                    }
                }
            }
        }
        let addReadVars = (blockId, name) => {
            for(let index in varReferences){
                if(varReferences[index][name] != undefined){
                    for(let i in varReferences[index]){
                        if(DFG.graph[blockId]["createVars"][i] == undefined)
                            DFG.graph[blockId]["readVars"][i] = varReferences[index][i];
                    }
                }
            }
        }
        let addReferenceVars = (newvar, oldvar, newvarType, oldvarType) => {
            let modified = false;
            if(newvarType.length >= 3 && oldvarType.length >= 3 && ((newvarType[2] == "memory" && oldvarType[2] == "memory") ||
            (newvarType[2] == "storage" && newvarType[1] == false && oldvarType[2] == "storage")) && newvarType[0].type != "ElementaryTypeName"){
                for(let index in varReferences){
                    if(varReferences[index][oldvar] != undefined){
                        varReferences[index][newvar] = newvarType;
                        modified = true;
                    }
                }
                if(modified == false){
                    let vars = {};
                    vars[oldvar] = oldvarType;
                    vars[newvar] = newvarType;
                    varReferences.push(vars);
                }
            }
        }
        initStatement(curBlockId);
        DFG.graph[curBlockId]["statementType"] = "Gensis";
        DFG.graph[curBlockId]["createVars"] = Object.assign(DFG.graph[curBlockId]["createVars"], stateVars);
        //implement data flow analysis on every statement
        let handleStatement = (statementNode, modifier = null) => {
            var write = false;
            var limitDepth = [];
            var notVars = {};
            var rightop = [];
            var init = false;
            var entered = false;
            if(statementNode == null)
                return 0;
            parser.visit(statementNode, {
                PrevAll: (node) => {
                    if(limitDepth.length != 0 && node.depth <= limitDepth[limitDepth.length - 1][0] + 1 && entered == true){
                        write = limitDepth[limitDepth.length - 1][1];
                        limitDepth.splice(limitDepth.length - 1, 1);
                    }
                    else if(limitDepth.length != 0 && node.depth <= limitDepth[limitDepth.length - 1][0] + 1 && entered == false){
                        entered = true;
                    }
                },
                VariableDeclaration: (node) => {
                    var varType = [];
                    varType.push(DFG.handleNode(node.typeName));
                    varType.push(node.isStateVar);
                    if(node.storageLocation != null){
                        varType.push(node.storageLocation);
                    }
                    else{
                        varType.push("storage");
                    }
                    DFG.graph[curBlockId]["createVars"][node.name] = varType;
                    localVars[node.name] = varType;
                    if(init == true){
                        DFG.graph[curBlockId]["assignVars"][node.name] = varType;
                        if(rightop != null && rightop.length == 2)
                            addReferenceVars(node.name, rightop[0], varType, rightop[1]);
                        init = false;
                    }
                },
                VariableDeclarationStatement: (node) => {
                    if(node.initialValue != null && node.initialValue != undefined){
                        if(node.initialValue.type == "Identifier"){
                            if(stateVars[node.initialValue.name] != undefined){
                                DFG.graph[curBlockId]["readVars"][node.initialValue.name] = stateVars[node.initialValue.name];
                                addReadVars(curBlockId, node.initialValue.name);
                            }
                            else if(DFG.builtinVars.indexOf(node.initialValue.name) != -1){
                                DFG.graph[curBlockId]["readVars"][node.initialValue.name] = ["built-in", true, "storage"];
                                addReadVars(curBlockId, node.initialValue.name);
                            }
                            else if(localVars[node.initialValue.name] != undefined){
                                DFG.graph[curBlockId]["readVars"][node.initialValue.name] = localVars[node.initialValue.name];
                                addReadVars(curBlockId, node.initialValue.name);
                            }
                            else{
                                DFG.graph[curBlockId]["readVars"][node.initialValue.name] = null;
                            }
                        }
                        if(node.initialValue.type != "BinaryOperation" && node.initialValue.type != "UnaryOperation")
                            rightop = checkLocation(node.initialValue);
                        else
                            rightop = null;
                        init = true;
                    }
                },
                IndexAccess: (node) => {
                    if(node.base.type == "Identifier" && (write == false || write == 2)){
                        if(stateVars[node.base.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.base.name] = stateVars[node.base.name];
                            addReadVars(curBlockId, node.base.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.base.name) != -1){
                            DFG.graph[curBlockId]["readVars"][node.base.name] = ["built-in", true, "storage"];
                            addReadVars(curBlockId, node.base.name);
                        }
                        else if(localVars[node.base.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.base.name] = localVars[node.base.name];
                            addReadVars(curBlockId, node.base.name);
                        }
                        else{
                            DFG.graph[curBlockId]["readVars"][node.base.name] = null;
                        }
                    }
                    else if(node.base.type == "Identifier" && (write == true || write == 2)){
                        if(stateVars[node.base.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.base.name] = stateVars[node.base.name];
                            addAssignVars(curBlockId, node.base.name);
                            if(write != 2 && rightop != null && rightop.length == 2 && node.depth == statementNode.depth + 1){
                                addReferenceVars(node.base.name, rightop[0], stateVars[node.base.name], rightop[1]);
                            }
                        }
                        else if(DFG.builtinVars.indexOf(node.base.name) != -1){
                            DFG.graph[curBlockId]["assignVars"][node.base.name] = ["built-in", true, "storage"];
                            addAssignVars(curBlockId, node.base.name);
                            if(write != 2 && rightop != null && rightop.length == 2 && node.depth == statementNode.depth + 1){
                                addReferenceVars(node.base.name, rightop[0], ["built-in", true, "storage"], rightop[1]);
                            }
                        }
                        else if(localVars[node.base.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.base.name] = localVars[node.base.name];
                            addAssignVars(curBlockId, node.base.name);
                            if(write != 2 && rightop != null && rightop.length == 2 && node.depth == statementNode.depth + 1){
                                addReferenceVars(node.base.name, rightop[0], localVars[node.base.name], rightop[1]);
                            }
                        }
                        else{
                            DFG.graph[curBlockId]["assignVars"][node.base.name] = null;
                        }
                    }
                    if(node.index.type == "Identifier"){
                        if(stateVars[node.index.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.index.name] = stateVars[node.index.name];
                            addReadVars(curBlockId, node.index.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.index.name) != -1){
                            DFG.graph[curBlockId]["readVars"][node.index.name] = ["built-in", true, "storage"];
                            addReadVars(curBlockId, node.index.name);
                        }
                        else if(localVars[node.index.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.index.name] = localVars[node.index.name];
                            addReadVars(curBlockId, node.index.name);
                        }
                        else{
                            DFG.graph[curBlockId]["readVars"][node.index.name] = null;
                        }
                    }
                    else{
                        limitDepth.push([node.depth, write]);
                        write = false;
                    }
                },
                MemberAccess: (node) => {
                    if(node.expression.type == "Identifier" && (write == false || write == 2)){
                        if(stateVars[node.expression.name] != undefined){
                            //DFG.graph[curBlockId]["readVars"][node.expression.name] = stateVars[node.expression.name];
                            //addReadVars(curBlockId, node.expression.name);
                            DFG.graph[curBlockId]["readVars"][node.memberName] = [["memberAccess", node.expression.name], stateVars[node.expression.name][1], stateVars[node.expression.name][2]];
                        }
                        else if(DFG.builtinVars.indexOf(node.expression.name) != -1){
                            //DFG.graph[curBlockId]["readVars"][node.expression.name] = ["built-in", true, "storage"];
                            //addReadVars(curBlockId, node.expression.name);
                            DFG.graph[curBlockId]["readVars"][node.memberName] = [["memberAccess", node.expression.name], "built-in", true, "storage"];
                        }
                        else if(localVars[node.expression.name] != undefined){
                            //DFG.graph[curBlockId]["readVars"][node.expression.name] = localVars[node.expression.name];
                            //addReadVars(curBlockId, node.expression.name);
                            DFG.graph[curBlockId]["readVars"][node.memberName] = [["memberAccess", node.expression.name], localVars[node.expression.name][1], localVars[node.expression.name][2]];
                        }
                        else{
                            //DFG.graph[curBlockId]["readVars"][node.expression.name] = null;
                            DFG.graph[curBlockId]["readVars"][node.memberName] = [["memberAccess", node.expression.name], null];
                        }
                        if(notVars[node.memberName] == node.expression){
                            delete DFG.graph[curBlockId]["readVars"][node.memberName];
                        }
                    }
                    if(node.expression.type == "Identifier" && (write == true || write == 2)){
                        if(stateVars[node.expression.name] != undefined){
                            //DFG.graph[curBlockId]["assignVars"][node.expression.name] = stateVars[node.expression.name];
                            DFG.graph[curBlockId]["assignVars"][node.memberName] = [["memberAccess", node.expression.name], stateVars[node.expression.name][1], stateVars[node.expression.name][2]];
                            //addAssignVars(curBlockId, node.expression.name);
                            if(write != 2 && rightop != null && rightop.length == 2 && node.depth == statementNode.depth + 1){
                                addReferenceVars(node.expression.name, rightop[0], stateVars[node.expression.name], rightop[1]);
                            }
                        }
                        else if(DFG.builtinVars.indexOf(node.expression.name) != -1){
                            //DFG.graph[curBlockId]["assignVars"][node.expression.name] = ["built-in", true, "storage"];
                            DFG.graph[curBlockId]["assignVars"][node.memberName] = [["memberAccess", node.expression.name], "built-in", true, "storage"];
                            //addAssignVars(curBlockId, node.expression.name);
                            if(write != 2 && rightop != null && rightop.length == 2 && node.depth == statementNode.depth + 1){
                                addReferenceVars(node.expression.name, rightop[0], ["built-in", true, "storage"], rightop[1]);
                            }
                        }
                        else if(localVars[node.expression.name] != undefined){
                            //DFG.graph[curBlockId]["assignVars"][node.expression.name] = localVars[node.expression.name];
                            DFG.graph[curBlockId]["assignVars"][node.memberName] = [["memberAccess", node.expression.name], localVars[node.expression.name][1], localVars[node.expression.name][2]];
                            //addAssignVars(curBlockId, node.expression.name);
                            if(write != 2 && rightop != null && rightop.length == 2 && node.depth == statementNode.depth + 1){
                                addReferenceVars(node.expression.name, rightop[0], localVars[node.expression.name], rightop[1]);
                            }
                        }
                        else{
                            //DFG.graph[curBlockId]["assignVars"][node.expression.name] = null;
                            DFG.graph[curBlockId]["assignVars"][node.memberName] = [["memberAccess", node.expression.name], null];
                        }
                        if(notVars[node.memberName] == node.expression){
                            delete DFG.graph[curBlockId]["assignVars"][node.memberName];
                        }
                    }
                    if(node.expression.type != "Identifier" && (write == false || write == 2)){
                        DFG.graph[curBlockId]["readVars"][node.memberName] = [["memberAccess", DFG.handleNode(node.expression)], null];
                        if(notVars[node.memberName] == node.expression){
                            delete DFG.graph[curBlockId]["readVars"][node.memberName];
                        }
                    }
                    if(node.expression.type != "Identifier" && (write == true || write == 2)){
                        DFG.graph[curBlockId]["assignVars"][node.memberName] = [["memberAccess", DFG.handleNode(node.expression)], null];
                        if(notVars[node.memberName] == node.expression){
                            delete DFG.graph[curBlockId]["assignVars"][node.memberName];
                        }
                    }
                },
                BinaryOperation: (node) => {
                    if((node.operator == "+=" || node.operator == "*=" || node.operator == "-=" || node.operator == "/=") && node.left.type == "Identifier"){
                        if(stateVars[node.left.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = stateVars[node.left.name];
                            DFG.graph[curBlockId]["readVars"][node.left.name] = stateVars[node.left.name];
                            addAssignVars(curBlockId, node.left.name);
                            addReadVars(curBlockId, node.left.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.left.name) != -1){
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = ["built-in", true, "storage"];
                            DFG.graph[curBlockId]["readVars"][node.left.name] = ["built-in", true, "storage"];
                            addAssignVars(curBlockId, node.left.name);
                            addReadVars(curBlockId, node.left.name);
                        }
                        else if(localVars[node.left.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = localVars[node.left.name];
                            DFG.graph[curBlockId]["readVars"][node.left.name] = localVars[node.left.name];
                            addAssignVars(curBlockId, node.left.name);
                            addReadVars(curBlockId, node.left.name);
                        }
                        else{
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = null;
                        }
                    }
                    else if((node.operator == "+=" || node.operator == "*=" || node.operator == "-=" || node.operator == "/=") && node.left.type != "Identifier"){
                        limitDepth.push([node.depth, write]);
                        write = true;
                    }
                    if(node.operator == "=" && node.left.type == "Identifier"){
                        if(stateVars[node.left.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = stateVars[node.left.name];
                            let res = checkLocation(node.right);
                            addAssignVars(curBlockId, node.left.name);
                            if(res != null && node.depth == statementNode.depth + 1 && node.right.type != "BinaryOperation"
                             && node.right.type != "UnaryOperation")
                                addReferenceVars(node.left.name, res[0], stateVars[node.left.name], res[1]);
                        }
                        else if(DFG.builtinVars.indexOf(node.left.name) != -1){
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = ["built-in", true, "storage"];
                            let res = checkLocation(node.right);
                            addAssignVars(curBlockId, node.left.name);
                            if(res != null && node.depth == statementNode.depth + 1 && node.right.type != "BinaryOperation"
                            && node.right.type != "UnaryOperation")
                                addReferenceVars(node.left.name, res[0], ["built-in", true, "storage"], res[1]);
                        }
                        else if(localVars[node.left.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = localVars[node.left.name];
                            let res = checkLocation(node.right);
                            addAssignVars(curBlockId, node.left.name);
                            if(res!= null && node.depth == statementNode.depth + 1 && node.right.type != "BinaryOperation"
                            && node.right.type != "UnaryOperation")
                                addReferenceVars(node.left.name, res[0], localVars[node.left.name], res[1]);
                        }
                        else{
                            DFG.graph[curBlockId]["assignVars"][node.left.name] = null;
                        }
                    }
                    else if(node.operator == "=" && node.left.type != "Identifier"){
                        limitDepth.push([node.depth, write]);
                        if(node.depth == statementNode.depth + 1 && node.right.type != "BinaryOperation"
                        && node.right.type != "UnaryOperation")
                            rightop = checkLocation(node.right);
                        else
                            rightop = null;
                        write = true;
                    }
                    else if(node.operator != "=" && node.left.type == "Identifier"){
                        if(stateVars[node.left.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.left.name] = stateVars[node.left.name];
                            addReadVars(curBlockId, node.left.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.left.name) != -1){
                            DFG.graph[curBlockId]["readVars"][node.left.name] = ["built-in", true, "storage"];
                            addReadVars(curBlockId, node.left.name);
                        }
                        else if(localVars[node.left.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.left.name] = localVars[node.left.name];
                            addReadVars(curBlockId, node.left.name);
                        }
                        else{
                            DFG.graph[curBlockId]["readVars"][node.left.name] = null;
                        }
                    }
                    if(node.right.type == "Identifier"){
                        if(stateVars[node.right.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.right.name] = stateVars[node.right.name];
                            addReadVars(curBlockId, node.right.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.right.name) != -1){
                            DFG.graph[curBlockId]["readVars"][node.right.name] = ["built-in", true, "storage"];
                            addReadVars(curBlockId, node.right.name);
                        }
                        else if(localVars[node.right.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.right.name] = localVars[node.right.name];
                            addReadVars(curBlockId, node.right.name);
                        }
                        else{
                            DFG.graph[curBlockId]["readVars"][node.right.name] = null;
                        }
                    }
                },
                UnaryOperation: (node) =>{
                    if(node.operator == "delete" && node.subExpression.type == "Identifier"){
                        if(stateVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["deleteVars"][node.subExpression.name] = stateVars[node.subExpression.name];
                        }
                        else if(DFG.builtinVars.indexOf(node.subExpression.name) != -1){
                            DFG.graph[curBlockId]["deleteVars"][node.subExpression.name] = ["built-in", true, "storage"];
                        }
                        else if(localVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["deleteVars"][node.subExpression.name] = localVars[node.subExpression.name];
                        }
                        else{
                            DFG.graph[curBlockId]["deleteVars"][node.subExpression.name] = null;
                        }
                        //deal with pointers, remove deleted vars
                        for(let i in varReferences){
                            for(let index in varReferences[i]){
                                if(node.subExpression.name == index){
                                    delete varReferences[i][index];
                                }
                            }
                            if(Object.keys(varReferences[i]).length < 2){
                                varReferences.splice(i,1);
                            }
                        }
                    }
                    else if((node.operator == "++" || node.operator == "--") && node.subExpression.type == "Identifier"){
                        if(stateVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = stateVars[node.subExpression.name];
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = stateVars[node.subExpression.name];
                            addAssignVars(curBlockId, node.subExpression.name);
                            addReadVars(curBlockId, node.subExpression.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.subExpression.name) != -1){
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = ["built-in", true, "storage"];
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = ["built-in", true, "storage"];
                            addAssignVars(curBlockId, node.subExpression.name);
                            addReadVars(curBlockId, node.subExpression.name);
                        }
                        else if(localVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = localVars[node.subExpression.name];
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = localVars[node.subExpression.name];
                            addAssignVars(curBlockId, node.subExpression.name);
                            addReadVars(curBlockId, node.subExpression.name);
                        }
                        else{
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = null;
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = null;
                        }
                    }
                    else if((node.operator == "++" || node.operator == "--") && node.subExpression.type != "Identifier"){
                        limitDepth.push([node.depth, write]);
                        write = 2;
                    }
                    else if(node.subExpression.type == "Identifier" && write != true){
                        if(stateVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = stateVars[node.subExpression.name];
                            addReadVars(curBlockId, node.subExpression.name);
                        }
                        else if(DFG.builtinVars.indexOf(node.subExpression.name) != -1){
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = ["built-in", true, "storage"];
                            addReadVars(curBlockId, node.subExpression.name);
                        }
                        else if(localVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = localVars[node.subExpression.name];
                            addReadVars(curBlockId, node.subExpression.name);
                        }
                        else{
                            DFG.graph[curBlockId]["readVars"][node.subExpression.name] = null;
                        }
                    }
                    else if(node.subExpression.type == "Identifier" && write == true){
                        if(stateVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = stateVars[node.subExpression.name];
                            addAssignVars(curBlockId, node.subExpression.name);
                            addReferenceVars(node.subExpression.name, rightop[0], stateVars[node.subExpression.name], rightop[1]);
                        }
                        else if(DFG.builtinVars.indexOf(node.subExpression.name) != -1){
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = ["built-in", true, "storage"];
                            addAssignVars(curBlockId, node.subExpression.name);
                            addReferenceVars(node.subExpression.name, rightop[0], ["built-in", true, "storage"], rightop[1]);
                        }
                        else if(localVars[node.subExpression.name] != undefined){
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = localVars[node.subExpression.name];
                            addAssignVars(curBlockId, node.subExpression.name);
                            addReferenceVars(node.subExpression.name, rightop[0], localVars[node.subExpression.name], rightop[1]);
                        }
                        else{
                            DFG.graph[curBlockId]["assignVars"][node.subExpression.name] = null;
                        }
                    }
                },
                FunctionCall: (node) => {
                    //handle arguments
                    for(let index in node.arguments){
                        if(node.arguments[index].type == "Identifier"){
                            if(stateVars[node.arguments[index].name] != undefined){
                                DFG.graph[curBlockId]["readVars"][node.arguments[index].name] = stateVars[node.arguments[index].name];
                                addReadVars(curBlockId, node.arguments[index].name);
                            }
                            else if(DFG.builtinVars.indexOf(node.arguments[index].name) != -1){
                                DFG.graph[curBlockId]["readVars"][node.arguments[index].name] = ["built-in", true, "storage"];
                                addReadVars(curBlockId, node.arguments[index].name);
                            }
                            else if(localVars[node.arguments[index].name] != undefined){
                                DFG.graph[curBlockId]["readVars"][node.arguments[index].name] = localVars[node.arguments[index].name];
                                addReadVars(curBlockId, node.arguments[index].name);
                            }
                            else{
                                DFG.graph[curBlockId]["readVars"][node.arguments[index].name] = null;
                            }
                        }
                    }
                    if(node.expression.type == "MemberAccess"){
                        notVars[node.expression.memberName] = node.expression.expression;
                    }
                }
            })
            for(let index in DFG.graph[curBlockId]["readVars"]){
                if(modifierParameters[index] != undefined && modifier != null){
                    delete(DFG.graph[curBlockId]["readVars"][index]);
                }
            }
            for(let index in DFG.graph[curBlockId]["assignVars"] && modifier != null){
                if(modifierParameters[index] != undefined){
                    delete(DFG.graph[curBlockId]["assignVars"][index]);
                }
            }
            for(let index in DFG.graph[curBlockId]["deleteVars"] && modifier != null){
                if(modifierParameters[index] != undefined){
                    delete(DFG.graph[curBlockId]["deleteVars"][index]);
                }
            }
        }
        //build control flow graph for data flow analysis behind
        let handleBlock = (blockNode, before = null) => {
            if(blockNode == null)
                return 0;
            var firstBlockId = 0;
            let after = false;
            parser.visit(blockNode, {
                ExpressionStatement: (node) => {
                    if(node.depth == blockNode.depth + 1){
                        if(firstBlockId == 0)
                            firstBlockId = node.id;
                        if(before == true && node.expression.type == "Identifier" && node.expression.name == "_"){
                            return 0;
                        }
                        else if(before == false && node.expression.type == "Identifier" && node.expression.name == "_"){
                            after = true;
                        }
                        else if((before == false && after == true) || before == null || before == true){
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "ExpressionStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            curCondition = null;
                            multiFlow = false;
                            multiBlockIds = {};
                            handleStatement(node, before);
                        }
                    }    
                },
                VariableDeclarationStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "VariableDeclarationStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            curCondition = null;
                            multiFlow = false;
                            multiBlockIds = {};
                            handleStatement(node, before);
                        }
                    }
                },
                IfStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1 || blockNode == node){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            //separate its true body and false body
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "IfStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            if(node.falseBody != null){
                                multiBlockIds = {};
                                curBlockId = node.id;
                                curCondition = DFG.handleNode(node.condition);
                                handleStatement(node.condition, before);
                                multiFlow = false;
                                handleBlock(node.trueBody);
                                multiBlockIds[curBlockId] = null;
                                curBlockId = node.id;
                                curCondition = DFG.handleNode(reverseCondition(node.condition));
                                handleBlock(node.falseBody);
                                curCondition = null;
                                multiFlow = true;
                                multiBlockIds[curBlockId] = null;
                            }
                            else{
                                multiBlockIds = {};
                                curBlockId = node.id;
                                curCondition = DFG.handleNode(node.condition);
                                handleStatement(node.condition, before);
                                multiFlow = false;
                                handleBlock(node.trueBody);
                                multiBlockIds[curBlockId] = null;
                                curBlockId = node.id;
                                curCondition = DFG.handleNode(reverseCondition(node.condition));
                                multiBlockIds[curBlockId] = curCondition;
                                curBlockId = null;
                                curCondition = null;
                                multiFlow = true;
                            }
                        }  
                    }
                },
                ForStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "ForStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            curCondition = null;
                            multiBlockIds = {};
                            multiFlow = false;
                            handleStatement(node.initExpression, before);
                            curCondition = DFG.handleNode(node.conditionExpression);
                            handleStatement(node.conditionExpression, before);
                            initStatement(node.loopExpression.id);
                            multiFlow = true;
                            multiBlockIds[node.loopExpression.id] = curCondition;
                            multiBlockIds[node.id] = curCondition;
                            handleBlock(node.body);
                            DFG.graph[node.loopExpression.id]["prevBlocks"][curBlockId] = null;
                            curBlockId = node.loopExpression.id;
                            handleStatement(node.loopExpression, before);
                            handleStatement(node.conditionExpression, before);
                            curCondition = DFG.handleNode(reverseCondition(node.conditionExpression));
                            multiBlockIds = {};
                            multiFlow = false;
                        }
                    }
                },
                WhileStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "WhileStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            handleStatement(node.condition, before);
                            curCondition = DFG.handleNode(node.condition);
                            multiFlow = false;
                            multiBlockIds = {};
                            var first = handleBlock(node.body);
                            DFG.graph[first]["prevBlocks"][curBlockId] = DFG.handleNode(node.condition);
                            multiFlow = false;
                            multiBlockIds = {};
                            curCondition = null;
                        }
                    }
                },
                DoWhileStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "DoWhileStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            multiFlow = false;
                            multiBlockIds = {};
                            curCondition = null;
                            var first = handleBlock(node.body);
                            DFG.graph[first]["prevBlocks"][curBlockId] = DFG.handleNode(node.condition);
                            handleStatement(node.condition, before);
                            multiFlow = false;
                            multiBlockIds = {};
                            curCondition = null;
                        }
                    }
                },
                ReturnStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "ReturnStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            curCondition = null;
                            multiFlow = false;
                            multiBlockIds = {};
                            handleStatement(node, before);
                        }
                    }
                },
                EmitStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "EmitStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            curCondition = null;
                            multiFlow = false;
                            multiBlockIds = {};
                            handleStatement(node, before);
                        }
                    }
                },
                ThrowStatement: (node) => {
                    if((before == false && after == true) || before == null || before == true){
                        if(node.depth == blockNode.depth + 1){
                            if(firstBlockId == 0)
                                firstBlockId = node.id;
                            initStatement(node.id);
                            DFG.graph[node.id]["statementType"] = "ThrowStatement";
                            if(multiFlow == false)
                                DFG.graph[node.id]["prevBlocks"][curBlockId] = curCondition;
                            else{
                                for(let index in multiBlockIds){
                                    DFG.graph[node.id]["prevBlocks"][index] = multiBlockIds[index];
                                }
                            }
                            curBlockId = node.id;
                            curCondition = null;
                            multiFlow = false;
                            multiBlockIds = {};
                            handleStatement(node, before);
                        }
                    }
                }
              })
              return firstBlockId;
        }
        //modifiers has special control flow to handle
        let handleModifiers = (before) => {
            var modifiers = [];
            //handle all modifiers(include the arguments both in definition and invocation)
            if(before == false){
                initStatement("Infinity");
                DFG.graph["Infinity"]["statementType"] = "End";
                DFG.graph["Infinity"]["prevBlocks"][curBlockId] = curCondition;
                curBlockId = "Infinity";
                curCondition = null;
            }
            for(let index in funcNode.modifiers){
                if(funcNode.modifiers[index].type == "ModifierInvocation"){
                    if(funcNode.modifiers[index].arguments.length != 0){
                        for(let i in funcNode.modifiers[index].arguments){
                            if(funcNode.modifiers[index].arguments[i].type == "Identifier"){
                                if(stateVars[funcNode.modifiers[index].arguments[i].name] != undefined){
                                    DFG.graph[curBlockId]["readVars"][funcNode.modifiers[index].arguments[i].name] = stateVars[funcNode.modifiers[index].arguments[i].name];
                                }
                                else if(DFG.builtinVars.indexOf(funcNode.modifiers[index].arguments[i].name) != -1){
                                    DFG.graph[curBlockId]["readVars"][funcNode.modifiers[index].arguments[i].name] = ["built-in", true, "storage"];
                                }
                                else if(localVars[funcNode.modifiers[index].arguments[i].name] != undefined){
                                    DFG.graph[curBlockId]["readVars"][funcNode.modifiers[index].arguments[i].name] = localVars[funcNode.modifiers[index].arguments[i].name];
                                }
                                else{
                                    DFG.graph[curBlockId]["readVars"][funcNode.modifiers[index].arguments[i].name] = null;
                                }
                            }
                            else{
                                handleStatement(funcNode.modifiers[index].arguments[i], true);
                            }
                        }
                    }
                    //add modifiers in its parent contracts
                    for(let t in DFG.allParentContracts){
                        let funcs = transformer.findNodeByName(DFG.allParentContracts[t], funcNode.modifiers[index].name);
                        for(let i in funcs){
                            if(funcs[i].type == "ModifierDefinition"){
                                modifiers.push(funcs[i]);
                                addFuncParameters(funcs[i], modifierParameters);
                            }
                        }
                    }
                    //add modifiers in its own contract
                    let funcs = transformer.findNodeByName(DFG.thisContract, funcNode.modifiers[index].name);
                    for(let i in funcs){
                        if(funcs[i].type == "ModifierDefinition"){
                            modifiers.push(funcs[i]);
                            addFuncParameters(funcs[i], modifierParameters);
                        }
                    }
                }
            }
            for(let index in modifiers){
                handleBlock(modifiers[index].body, before);
            }

        }
        handleModifiers(true);
        handleBlock(funcNode.body);
        handleModifiers(false);
        DFG.format();
        DFG.localVars = localVars;
        DFG.varReferences = varReferences;
        return DFG.graph;
        //return varReferences;
    }, 

    format: () => {
        for(let index in DFG.graph){
            for(let i in DFG.graph[index]["prevBlocks"]){
                if(DFG.graph[i] != undefined)
                    DFG.graph[i]["postBlocks"][index] = DFG.graph[index]["prevBlocks"][i];
            }
        }
        var modified = true;
        while(modified){
            modified = false;
            for(let index in DFG.graph){
                let oldLength = Object.keys(DFG.graph[index]["inputVars"]).length; 
                for(let i in DFG.graph[index]["prevBlocks"]){
                    if(i == index || DFG.graph[i] == undefined)
                        break;
                    for(let x in DFG.graph[i]["outputVars"]){
                        let varType = [DFG.graph[i]["outputVars"][x][0], DFG.graph[i]["outputVars"][x][1], DFG.graph[i]["outputVars"][x][2]];
                        DFG.graph[index]["inputVars"][x] = varType;
                        if(DFG.graph[index]["inputVars"][x].indexOf(i) == -1){
                            DFG.graph[index]["inputVars"][x].push(i);
                        }
                    }
                }
                let newLength = Object.keys(DFG.graph[index]["inputVars"]).length;
                if(oldLength != newLength)
                    modified = true;
                oldLength = Object.keys(DFG.graph[index]["outputVars"]).length;
                for(let x in DFG.graph[index]["inputVars"]){
                    let varType = [DFG.graph[index]["inputVars"][x][0], DFG.graph[index]["inputVars"][x][1], DFG.graph[index]["inputVars"][x][2]];
                    DFG.graph[index]["outputVars"][x] = varType;
                }
                for(let x in DFG.graph[index]["createVars"]){
                    DFG.graph[index]["outputVars"][x] = DFG.graph[index]["createVars"][x];
                }
                for(let i in DFG.graph[index]["deleteVars"]){
                    if(DFG.graph[index]["outputVars"].hasOwnProperty(i) == true){
                        delete DFG.graph[index]["outputVars"][i];
                    }
                }
                newLength = Object.keys(DFG.graph[index]["outputVars"]).length;
                if(oldLength != newLength)
                    modified = true;
                oldLength = Object.keys(DFG.graph[index]["noopVars"]).length;
                for(let i in DFG.graph[index]["inputVars"]){
                    if(DFG.graph[index]["readVars"].hasOwnProperty(i) == false && 
                    DFG.graph[index]["assignVars"].hasOwnProperty(i) == false &&
                    DFG.graph[index]["createVars"].hasOwnProperty(i) == false &&
                    DFG.graph[index]["deleteVars"].hasOwnProperty(i) == false){
                        let varType = [DFG.graph[index]["inputVars"][i][0], DFG.graph[index]["inputVars"][i][1], DFG.graph[index]["inputVars"][i][2]];
                        DFG.graph[index]["noopVars"][i] = varType;
                    }
                }
                newLength = Object.keys(DFG.graph[index]["noopVars"]).length;
                if(oldLength != newLength)
                    modified = true;
            }
        }
    }

}


module.exports = DFG;