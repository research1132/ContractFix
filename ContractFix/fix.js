const appRoot = require("app-root-path");
const transformer = require(appRoot + "/src/ast-transformer");
const ad = require(appRoot + '/src/advancedtransformer');
const dependency = require(appRoot + '/src/DependencyAnalysis');
const DFG = require(appRoot + '/src/DFG');
const fs = require("fs");
const utils = require(appRoot + "/src/utils");


fix = {
    fixMissingInputValidation: (violations, ast) => {
        console.log("Fixing MissingInputValidation...");
        var res = {};
        res["fixed"] = [];
        res["unfixed"] = [];
        var forrepairs = [];
        if(violations instanceof Array){
            forrepairs = forrepairs.concat(violations);
        }
        else if(violations["MissingInputValidation"] != undefined){
            forrepairs = forrepairs.concat(violations["MissingInputValidation"]);
        }
        else{
            console.log("Please check the input.\n");
            return res;
        }
        //now we can only fix address parameters
        for(let index in forrepairs){
            console.log("Fixing " + forrepairs[index] + " ...");
            let funcs = transformer.findNodeByLine(ast, forrepairs[index]);
            for(let func in funcs){
                if(funcs[func].type == "FunctionDefinition" && funcs[func].loc.start.line == 
                forrepairs[index]){
                    let parameters = ad.getParameters(funcs[func]);
                    for(let parameter in parameters){
                        if(parameters[parameter] == "address"){
                            //skip the parameters which have been checked by programmer
                            let skip = false;
                            let functioncalls = transformer.findNodeByType(funcs[func], "FunctionCall");
                            let requires = [];
                            for(let i in functioncalls){
                                if(functioncalls[i].expression.type == "Identifier" && functioncalls[i].expression.name == "require"){
                                    requires.push(functioncalls[i]);
                                }
                            }
                            for(let i in requires){
                                if(requires[i].arguments.length == 1 && requires[i].arguments[0].type == "BinaryOperation"
                                && requires[i].arguments[0].operator == "!=" && requires[i].arguments[0].left.type == "Identifier"
                                && requires[i].arguments[0].left.name == parameter){
                                    skip = true;
                                    break;
                                }
                            }
                            if(skip == true){
                                break;
                            }
                            //check parameters
                            let check = ad.checkAddress(parameter);
                            funcs[func].body.statements.unshift(check);
                        }
                    }
                    res["fixed"].push(forrepairs[index]);
                    break;
                }
            }
        }
        for(let index in forrepairs){
            if(res["fixed"].indexOf(forrepairs[index]) == -1){
                res["unfixed"].push(forrepairs[index]);
            }
        }
        console.log("MissingInputValidation fix finished.");
        return res;
    },
    fixUnhandledException: (violations, ast) => {
        console.log("Fixing Unhandled Exception...");
        var res = {};
        res["fixed"] = [];
        res["unfixed"] = [];
        var forrepairs = [];
        if(violations instanceof Array){
            forrepairs = forrepairs.concat(violations);
        }
        else if(violations["UnhandledException"] != undefined){
            forrepairs = forrepairs.concat(violations["UnhandledException"]);
        }
        else{
            console.log("Please check the input.\n");
            return res;
        }
        for(let index in forrepairs){
            console.log("Fixing " + forrepairs[index] + " ...");
            let statements = transformer.findNodeByLine(ast, forrepairs[index]);
            for(let statement in statements){
                if(statements[statement].type == "ExpressionStatement" && statements[statement].loc.start.line ==
                forrepairs[index]){
                    let newnode = ad.addCheck(statements[statement].expression);
                    transformer.replaceNode(ast, newnode, statements[statement]);
                    res["fixed"].push(forrepairs[index]);
                    break;
                }
            }
        }
        for(let index in forrepairs){
            if(res["fixed"].indexOf(forrepairs[index]) == -1){
                res["unfixed"].push(forrepairs[index]);
            }
        }
        console.log("UnhandledException fix finished.");
        return res;
    },
    fixLockedEther: (violations, ast) => {
        console.log("Fixing LockedEther...");
        var res = {};
        res["fixed"] = [];
        res["unfixed"] = [];
        var forrepairs = [];
        if(violations instanceof Array){
            forrepairs = forrepairs.concat(violations);
        }
        else if(violations["LockedEther"] != undefined){
            forrepairs = forrepairs.concat(violations["LockedEther"]);
        }
        else{
            console.log("Please check the input.\n");
            return res;
        }
        //find the contracts which must add withdraw()
        let mustfixes = [];
        let mustfixenames = [];
        for(let index in forrepairs){
            console.log("Fixing " + forrepairs[index] + " ...");
            let contracts = transformer.findNodeByLine(ast, forrepairs[index]);
            for(let contract in contracts){
                if(contracts[contract].type == "ContractDefinition" && contracts[contract].loc.start.line == 
                forrepairs[index]){
                    if(contracts[contract].baseContracts.length == 0){
                        mustfixes.push(contracts[contract]);
                        mustfixenames.push(contracts[contract].name);
                        res["fixed"].push(forrepairs[index]);
                    }
                    else{
                        let added = false;
                        for(let parent in contracts[contract].baseContracts){
                            if(mustfixenames.indexOf(contracts[contract].baseContracts[parent]) != -1){
                                res["fixed"].push(forrepairs[index]);
                                added = true;
                            }
                        }
                        if(added == false){
                            mustfixes.push(contracts[contract]);
                            mustfixenames.push(contracts[contract].name);
                            res["fixed"].push(forrepairs[index]);
                        }
                    }
                }
            }
        }
        //add withdraw() to every contract
        for(let index in mustfixes){
            let ownerName = ad.getOwner(ast, mustfixes[index]);
            //if there is not a owner, create one and initialize it
            if(ownerName == null){
                ownerName = "owner";
                let owner = ad.createOwner();
                transformer.insertPrevNode(ast, owner, mustfixes[index].subNodes[0]);
                let constructor = ad.getConstructor(mustfixes[index]);
                if(constructor == null){
                    constructor = ad.createConstructor(ownerName);
                    for(let func in mustfixes[index].subNodes){
                        if(mustfixes[index].subNodes[func].type == "FunctionDefinition"){
                            transformer.insertPrevNode(ast, constructor, mustfixes[index].subNodes[func]);
                            break;
                        }
                    }
                }
                else{
                    let ownerinit = ad.initOwner(ownerName);
                    if(constructor.body.statements.length != 0)
                        transformer.insertPrevNode(ast, ownerinit, constructor.body.statements[0]);
                    else
                        constructor.body.statements.push(ownerinit);
                }
            }
            //insert withdraw()
            let withdraw = ad.createWithdrawFunc(ownerName, "withdraw_fixLockedEther");
            transformer.insertPostNode(ast, withdraw, mustfixes[index].subNodes[mustfixes[index].subNodes.length - 1]);
        }
        for(let index in forrepairs){
            if(res["fixed"].indexOf(forrepairs[index]) == -1){
                res["unfixed"].push(forrepairs[index]);
            }
        }
        console.log("LockedEther fix finished.");
        return res;
    },
    fixDAO: (violations, ast) => {
        //some assistance function to help fix DAO
        let noDependencyFix = (stateVarsAssignment, externalCall) => {
            let assignmentNode = transformer.cloneNode(transformer.findNodeById(ast, stateVarsAssignment));
            let externalCallNode = transformer.findNodeById(ast, externalCall);
            transformer.deleteNode(ast, transformer.findNodeById(ast, stateVarsAssignment));
            transformer.insertPrevNode(ast, assignmentNode, externalCallNode);
        }
        let onlyWARFix = (stateVarsAssignment, externalCall, war, functionDFG) => {
            let tempvars = {};
            let tempvarsDefinitions = {};
            for(let i = 1; i < war.length; i++){
                if(functionDFG[war[i][2]]["assignVars"][war[i][0]][0] instanceof Array){
                    if(tempvarsDefinitions[war[i][0]] == undefined){
                        tempvarsDefinitions[war[i][0]] = ad.createTempVar(war[i][0], ad.createMemberAccess(war[i][0], functionDFG[war[i][2]]["assignVars"][war[i][0]][0][1]));
                        tempvars[war[i][0]] = ad.createIdentifier(war[i][0] + '_temp');
                    }
                    let statementNode = transformer.findNodeById(ast, war[i][1]);
                    let memberAccesses = transformer.findNodeByType(statementNode, "MemberAccess");
                    for(let j in memberAccesses){
                        //console.log(memberAccesses);
                        if(memberAccesses[j].expression.type == "Identifier" && memberAccesses[j].memberName == war[i][0] && memberAccesses[j].expression.name == functionDFG[war[i][2]]["assignVars"][war[i][0]][0][1]){
                            transformer.replaceNode(ast, tempvars[war[i][0]], memberAccesses[j]);
                            break;
                        }
                    }
                }
                else{
                    if(tempvarsDefinitions[war[i][0]] == undefined){
                        tempvarsDefinitions[war[i][0]] = ad.createTempVar(war[i][0], ad.createIdentifier(war[i][0]));
                        tempvars[war[i][0]] = ad.createIdentifier(war[i][0] + '_temp');
                    }
                    let statementNode = transformer.findNodeById(ast, war[i][1]);
                    let identifiers = transformer.findNodeByName(statementNode, war[i][0]);
                    for(let j in identifiers){
                        if(identifiers.type == "Identifier"){
                            transformer.replaceNode(ast, tempvars[war[i][0]], identifiers[j]);
                        }
                    }
                }
            }
            let externalCallNode = transformer.findNodeById(ast, externalCall);
            //add temp var definitions
            for(let i in tempvarsDefinitions){
                transformer.insertPrevNode(ast, tempvarsDefinitions[i], externalCallNode);
            }
            //move assignment ahead
            let assignmentNode = transformer.cloneNode(transformer.findNodeById(ast, stateVarsAssignment));
            transformer.deleteNode(ast, transformer.findNodeById(ast, stateVarsAssignment));
            transformer.insertPrevNode(ast, assignmentNode, externalCallNode);
        }
        let moveToLastStatement = (functionCall, funcNode) => {
            //create temp var for external call's arguments
            let tempvarsDefinitions = [];
            let calls = transformer.findNodeByType(functionCall, "FunctionCall");
            let index = 0;
            let tempString = "argument";
            for(let i in calls){
                for(let j in calls[i].arguments){
                    tempvarsDefinitions.push(ad.createTempVar(tempString + index.toString(), transformer.cloneNode(calls[i].arguments[j])));
                    transformer.replaceNode(ast, ad.createIdentifier(tempString + index.toString() + "_temp"), calls[i].arguments[j]);
                    index++;
                }
            }
            for(let i in tempvarsDefinitions){
                transformer.insertPrevNode(ast, tempvarsDefinitions[i], functionCall);
            }
            let call = transformer.cloneNode(functionCall);
            //check if external function call is included in a block(not the function definition body)
            let blocks = transformer.findNodeByType(funcNode, "Block");
            let pushed = false;
            for(let i in blocks){
                if(blocks[i].id != funcNode.body.id){
                    for(let k in blocks[i].statements){
                        if(blocks[i].statements[k].id == functionCall.id){
                            blocks[i].statements.push(call);
                            pushed = true;
                            break;
                        }
                    }
                    if(pushed == true)
                        break;
                }
            }
            transformer.deleteNode(ast, functionCall);
            if(pushed == false){
                funcNode.body.statements.push(call);
            }
        }
        console.log("Fixing DAO...");
        let res = {};
        res["fixed"] = [];
        res["unfixed"] = [];
        var forrepairs = [];
        if(violations instanceof Array){
            forrepairs = forrepairs.concat(violations);
        }
        else if(violations["DAO"] != undefined){
            forrepairs = forrepairs.concat(violations["DAO"]);
        }
        else{
            console.log("Please check the input.\n");
            return res;
        }
        //fix each vulnerability
        for(let index in forrepairs){
            console.log("Fixing " + forrepairs[index] + "...");
            let statements = transformer.findNodeByLine(ast, forrepairs[index]);
            for(let i in statements){
                if(statements[i].type == "ExpressionStatement" && statements[i].loc.start.line == forrepairs[index]){
                    let externalCall = statements[i];
                    let funcNode = transformer.findIncludedGlobalDef(ast, externalCall);
                    let stateVarsAssignments = dependency.findStateVarsAssignments(ast, externalCall, funcNode);
                    let functionDFG = DFG.generate(ast, funcNode);
                    let externalCallId = externalCall.id;
                    if(stateVarsAssignments.length == 0 && dependency.singleStatementDep(externalCall.id, functionDFG) == false){
                        moveToLastStatement(externalCall, funcNode);
                        if(res["fixed"].indexOf(forrepairs[index]) == -1)
                            res["fixed"].push(forrepairs[index]);
                    }
                    else{
                        //move state var assignment ahead one by one
                        let fixed = true;
                        for(let j in stateVarsAssignments){
                            let war = dependency.war_exists(externalCallId, stateVarsAssignments[j], functionDFG, ast);
                            let waw = dependency.waw_exists(externalCallId, stateVarsAssignments[j], functionDFG, ast);
                            let raw = dependency.raw_exists(externalCallId, stateVarsAssignments[j], functionDFG);
                            if(war[0] == false && waw[0] == false && raw[0] == false){
                                noDependencyFix(stateVarsAssignments[j], externalCallId);
                            }
                            else if(war[0] == true && waw[0] == false && raw[0] == false){
                                onlyWARFix(stateVarsAssignments[j], externalCallId, war, functionDFG);
                            }
                            else if(raw[0] == true && waw[0] == false){
                                let externalCallDep = false;
                                for(let i in raw){
                                    if(i > 0 && raw[i].indexOf(externalCallId) != -1){
                                        externalCallDep = true;
                                        break;
                                    }
                                }
                                if(externalCallDep == false){
                                    moveToLastStatement(externalCall, funcNode);
                                }
                            }
                            else{
                                fixed = false;
                            }
                        }
                        if(res["fixed"].indexOf(forrepairs[index]) == -1 && fixed == true)
                            res["fixed"].push(forrepairs[index]);
                    }
                    break;
                }
            }
        }
        for(let index in forrepairs){
            if(res["fixed"].indexOf(forrepairs[index]) == -1){
                res["unfixed"].push(forrepairs[index]);
            }
        }
        console.log("DAO fix finished.");
        return res;
    },

    //fix DAO using locking variable
    fixDAOWithLock: (violations, ast, reportlist) => {
        console.log("Fixing Reentrancy With Locked Variable...");
        var res = {};
        res["fixed"] = [];
        res["unfixed"] = [];
        var forrepairs = [];
        var lockedAddedForContracts = new Map();
        var functionFixed = new Map();
        if(violations instanceof Array){
            forrepairs = forrepairs.concat(violations);
        }
        else if(violations["DAO"] != undefined){
            forrepairs = forrepairs.concat(violations["DAO"]);
        }
        else{
            console.log("Please check the input.\n");
            return res;
        }
        //fix vulnerability
        var slither_report = null;
        for (let index in reportlist){
            if (reportlist[index].indexOf("-slither.json") != -1) {
                slither_report = reportlist[index];
            }
        }
        var slither_report_json = JSON.parse(fs.readFileSync(slither_report));
        var lineToContractAndFunction = fix.modifySlitherReport(slither_report_json);
        for(let index in forrepairs){
            console.log("Fixing " + forrepairs[index] + " by lock ...");
            var line = forrepairs[index];
            var arr = lineToContractAndFunction.get(line.toString());
            var functionName = arr[0];
            functionName = functionName.substring(0, functionName.indexOf("\("));
            functionName = functionName.trim();
            console.log("Function name: " + functionName);
            var contractName = arr[1].trim();
            var contractNodeArr = transformer.findNodeByDepth(ast, 1);
            var contractNode = null;
            for (let index in contractNodeArr){
                var curNode = contractNodeArr[index];
                if (curNode.name == contractName) {
                    contractNode = curNode;
                }
            }
            if (!lockedAddedForContracts.has(contractName)){
                lockedAddedForContracts.set(contractName, true);
                var locakDef = ad.createGlobalVariable();
                transformer.insertPrevNode(ast, locakDef, contractNode.subNodes[0]);
            }
            // make lock as the first statement of the function
            if(!functionFixed.has(functionName)) {
                var checkLock = ad.checkLock();
                var changeLockToTrue = ad.assignLockToTrueOrFalse("true");
                var vulFunctionNode = transformer.findFunction(contractNode, 1, functionName);
                var vulFunctionBody = vulFunctionNode.body;
                transformer.insertPrevNode(ast, changeLockToTrue, vulFunctionBody.statements[0]);
                transformer.insertPrevNode(ast, checkLock, vulFunctionBody.statements[0]);

                //change lock to false

                var changeLockToFalse = ad.assignLockToTrueOrFalse("false");
                transformer.insertPostNode(ast, changeLockToFalse,
                    vulFunctionBody.statements[vulFunctionBody.statements.length - 1]);
                functionFixed.set(functionName, true);
            }
            res['fixed'].push(line);

        }
    },

    modifySlitherReport:(slitherReportJson) => {
        var lineMap = new Map();
        var reentrancyViolations = slitherReportJson['Reentrancy'];
        for (let index in reentrancyViolations){
            var currentVio = reentrancyViolations[index];
            var funcationName = currentVio["function"]["name"];
            var contractName = currentVio["function"]["contract"];
            var stateVar = currentVio['function']['variable_after_external_call'];
            var externalCall = currentVio['function']['external_calls'];
            for (let k in stateVar) {
                var lineNumber= stateVar[k];
                lineMap.set(lineNumber, [funcationName, contractName]);
            }
            for (let k in externalCall) {
                var lineNumber2 = externalCall[k];
                lineMap.set(lineNumber2, [funcationName, contractName]);
            }
        }
        return lineMap;
    },


    fixAll: (violations, ast) => {
        var res = {};
        if(violations["UnhandledException"] != undefined){
            res["UnhandledException"] = fix.fixUnhandledException(violations["UnhandledException"], ast);
        }
        if(violations["MissingInputValidation"] != undefined){
            res["MissingInputValidation"] = fix.fixMissingInputValidation(violations["MissingInputValidation"], ast);
        }
        if(violations["LockedEther"] != undefined){
            res["LockedEther"] = fix.fixLockedEther(violations["LockedEther"], ast);
        }
        if(violations["DAO"] != undefined){
            res["DAO"] = fix.fixDAO(violations["DAO"], ast);
        }
        return res;
    },

    fixAllWithReports: (violations, ast, reportList) => {
      var res={};
        if(violations["UnhandledException"] != undefined){
            res["UnhandledException"] = fix.fixUnhandledException(violations["UnhandledException"], ast);
        }
        if(violations["MissingInputValidation"] != undefined){
            res["MissingInputValidation"] = fix.fixMissingInputValidation(violations["MissingInputValidation"], ast);
        }
        if(violations["LockedEther"] != undefined){
            res["LockedEther"] = fix.fixLockedEther(violations["LockedEther"], ast);
        }
        if(violations["DAO"] != undefined){
            res["DAO"] = fix.fixDAO(violations["DAO"]);  // need to modify back to DAO
        }
        if (res["DAO"]["unfixed"].length != 0) {
            res["DAOFixedByLock"] = fix.fixDAOWithLock(res["DAO"]["unfixed"], ast, reportList);
        }
        return res;

    }
}



module.exports = fix;