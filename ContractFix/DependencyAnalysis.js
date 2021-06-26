const appRoot = require("app-root-path");
const transformer = require(appRoot + "/src/ast-transformer");
const dfg = require(appRoot+"/src/DFG");
const utils = require(appRoot+"/src/utils");

let Analyzer = {
    liveAnalysis: (ast, functionName) => {
        let functionNode = transformer.findFunction(ast, 1, functionName);
        let functionDFG = dfg.generate(ast, functionNode);
        let out_map = new Map();
        let in_map = new Map();
        let def_map = new Map();
        let out_map_2 = new Map();
        let in_map_2 = new Map();
        let def_map_2 = new Map();
        let blockID = [];
        for(let id in functionDFG){
            blockID.push(id);
        }

        for(let i = 0; i < blockID.length; i++){
            let id = blockID[i];
            in_map[id] = [];
            out_map[id] = [];
            def_map[id] = [];
            in_map_2[id] = [];
            out_map_2[id] = [];
            def_map_2[id] = [];
        }
        do{
            for(let i = 0; i < blockID.length; i++) {
                id = blockID[i];
                in_map_2[id] = in_map[id];
                out_map_2[id] = out_map[id];
                in_map[id] = Analyzer.update_in_var_list(functionDFG[id].readVars,
                    functionDFG[id].outputVars,
                    functionDFG[id].assignVars);
                out_map[id] = Analyzer.update_out_var_list(functionDFG[id].postBlocks, functionDFG);
            }
        }while (!Analyzer.reachStable(in_map, in_map_2, out_map, out_map_2))

        Analyzer.output_input_vars(in_map);
        Analyzer.output_out_vars(out_map);

    },

    // verify whether the result of in_map and out_map become stable
    reachStable: function (in_map, in_map_2, out_map, out_map_2) {
        console.log(in_map);
       for (let id in in_map){
           in_map[id].sort();
           in_map_2[id].sort();
           for (i = 0; i < in_map[id].length; i++){
               if(in_map[id][i] != in_map_2[id][i]){
                   return false;
               }
           }
       }

       for (let id in out_map){
           out_map[id].sort();
           out_map_2[id].sort();
           for (i = 0; i < out_map[id].length; i++){
               if (out_map[id][i] != out_map_2[id][i]){
                   return false;
               }
           }
       }
       return true;
    },
    /*update input variable list*/
    update_in_var_list: function(readVars, outVars, assignVars) {
        let set = new Set();
        let res = [];
        for (let k in readVars){
            if(!set.has(k)) {
                res.push(k);
                set.add(k);
            }
        }

        for(let v in outVars){
            if(v in assignVars){
                continue;
            }else{
                if(!set.has(v)) {
                    res.push(v);
                    set.add(v);
                }
            }
        }
        return res;
    },

    update_out_var_list: function(postBlocks, dfg) {
        let res = [];
        for(let b in postBlocks){
            let inputVars = dfg[b].inputVars;
            for(let v in inputVars){
                if(!res.includes(v)) {
                    res.push(v);
                }
            }
        }
        return res;
    },

    output_input_vars: function(in_map)  {
        for(let k in in_map){
            console.log("BlockID: " + k + " Input Variables: " + in_map[k]);
        }
    },

    output_out_vars: function(out_map){
        for(let k in out_map){
            console.log("BlockID: " + k + " Out Variables: " + out_map[k]);
        }
    },
    // Here is some false dependency need huristic rule to filter out this false dependencies
    dependency_analysis: (ast, functionName) => {
    //   let var_list = [];
      let right_var_list = [];
      let functionNode = transformer.findFunction(ast, 1, functionName);
      let functionDFG = dfg.generate(ast, functionNode);
      utils.printPretty(functionDFG);
    //   let blockID = [];
    // // key is assigned variable, value contains the variable the key depends
        let dependency_relations = new Map();
        let cur_block = "0";
        let cur_blocks = [];
        cur_blocks.push("0");
        let variable_versions = new Map();
        let right_equ_blocks = new Set();

        while(cur_blocks.length != 0){
            cur_block = cur_blocks.shift();
            let def_vars = Analyzer.processDefVariables(cur_block, functionDFG);
            console.log("Def variables: "+ def_vars);
            console.log("right equ blocks: "+ right_equ_blocks.toString());
            for(let i =0; i < def_vars.length; i++){
                if(!right_equ_blocks.has(cur_block)) {
                    right_var_list.push(def_vars[i]);
                    right_equ_blocks.add(cur_block);
                }
            }
            console.log("right var list:" + right_var_list);
            while(right_var_list.length!=0){
                let cur_def_var = right_var_list.pop();
                if(!(cur_def_var in variable_versions)){
                    variable_versions[cur_def_var] = [];
                    variable_versions[cur_def_var].push(cur_def_var);
                }else{
                    variable_versions[cur_def_var].push(cur_def_var+variable_versions[cur_def_var].length);
                }
                cur_def_var = variable_versions[cur_def_var][variable_versions[cur_def_var].length-1];
                let dependency = Analyzer.findUse(cur_def_var, cur_block, functionDFG, variable_versions);
                if(!(cur_def_var in dependency_relations)) {
                    console.log("Create list for variable: "+cur_def_var);
                    dependency_relations[cur_def_var] = new Map();
                }
                console.log("Returned dependency is: "+ JSON.stringify(dependency));
                for(let v in dependency){
                    dependency_relations[cur_def_var][v] = dependency[v];
                }
            }
            for(let block in functionDFG[cur_block].postBlocks){
                cur_blocks.push(block);
            }
            console.log("Dependency relation is: ");
            console.log(JSON.stringify(dependency_relations));
        }
        return dependency_relations;
    },

    processDefVariables: function(block, dfg) {
        let res = [];
        let def_vars = dfg[block].assignVars;
        let usertype_member_access = new Set();
        for(let candidate in def_vars){
            if(typeof (def_vars[candidate][0]) == "object" && def_vars[candidate][0]["type"] == "ElementaryTypeName"){
                res.push(candidate);
            }else if(typeof(def_vars[candidate][0]) == "string" && def_vars[candidate][0] == "memberAccess"){
                let whole_name = def_vars[candidate][1]+"."+candidate;
                res.push(whole_name);
                usertype_member_access.add(def_vars[candidate][1]);
            }else if(typeof (def_vars[candidate][0]) == "object" && def_vars[candidate][0]["type"] == "built-in"){
                res.push(candidate);
            }else if(typeof (def_vars[candidate][0]) == "object" && def_vars[candidate][0]["type"] == "UserDefinedTypeName"){
                if(!usertype_member_access.has(candidate)){
                    res.push(candidate);
                    usertype_member_access.add(candidate);
                }
            }
        }
        return res;
    },

    processReadVariables: function(block, functionDFS) {
        let res = [];
        let read_vars = functionDFS[block].readVars;
        let usertype_member_access = new Set();
        for(let v in read_vars){
            if(typeof (read_vars[v][0]) == "object" && read_vars[v][0]["type"] == "ElementaryTypeName"){
                res.push(v);
            }else if(read_vars[v][0] == "built-in"){
                res.push(v);
            }else if(read_vars[v][0] == "memberAccess"){
                let whole_name = read_vars[v][1] +"." + v;
                res.push(whole_name);
                usertype_member_access.add(read_vars[v][1]);
            }else if(typeof (read_vars[v][0]) == "object" && read_vars[v][0]["type"] == "UserDefinedTypeName"){
                if(!usertype_member_access.has(v)){
                    res.push(v);
                    usertype_member_access.add(v);
                }
            }
        }
        return res;
    },

    findUse: function(cur_var, start_block, functionDFG, variable_version) {
        let dependency = new Map();
        let cur_block_list = [];
        cur_block_list.push(start_block);
        console.log("cur_var: "+ cur_var);
        while(cur_block_list.length != 0){
            let cur_block = cur_block_list.shift();
            let read_vars = Analyzer.processReadVariables(cur_block, functionDFG);
            let assign_vars = Analyzer.processDefVariables(cur_block, functionDFG);
            for(let read_var in read_vars){
                read_var_with_version = Analyzer.getNewestVersionVariable(variable_version, read_var);
                console.log("read_var: "+ read_var);
                if(cur_var == read_var_with_version && Analyzer.isClearPath(start_block, cur_block, read_var, functionDFG)){
                    for(let assign_var in assign_vars){
                        assign_var = Analyzer.getNewestVersionVariable(variable_version, assign_var);
                        dependency[assign_var] = Analyzer.must_follow_or_may_follow(start_block, cur_block, cur_block, functionDFG, cur_var);
                    }
                }
            }

            for(let block in functionDFG[cur_block].postBlocks){
                cur_block_list.push(block);
            }
        }
        console.log("For input var: " +cur_var + " Block ID: " + start_block);
        console.log("Dependency is: "+ JSON.stringify(dependency));
        return dependency;
    },

    getNewestVersionVariable: function(variable_map, variable){
        if(!(variable in variable_map)){
            return variable;
        }
        return variable_map[variable][variable_map[variable].length-1];
    },

    must_follow_or_may_follow: function(prv_block, middle, end_block, functionDFG, cur_var) {
        if(prv_block == middle){
            return prv_block + " Must " + end_block;
        }
        if(functionDFG[middle].prevBlocks.size > 1){
            return prv_block + " May " + end_block;
        }else{
            for(let next_prv in functionDFG[middle].prevBlocks){
                return Analyzer.must_follow_or_may_follow(prv_block, next_prv, end_block, functionDFG);
            }
        }

    },
    isClearPath: function(start_block, dst_block, variable, functionDFG) {
        if(start_block == dst_block){
            return true;
        }
        let res = true;
        for(let block in functionDFG[start_block].postBlocks){
            if(variable in functionDFG[block].assignVars){
                return false;
            }else{
                res = res && Analyzer.isClearPath(block, dst_block, variable, functionDFG);
            }
        }
        return res;
    },

    findStartBlock: function (functionDFG) {
      for(let block in functionDFG){
          if(functionDFG[block].prevBlocks.length == undefined){
              return block;
          }
          console.log("prev block size is: "+ functionDFG[block].prevBlocks.length);
      }
      console.log("Does't find start block for def-use analysis");
    },

    updateDependency: function (dependency_relations, variable) {
        let readVars = dependency_relations[variable];
        for(let rVar in readVars){
            if(dependency_relations.has(rVar)){
                let subdep = dependency_relations[rVar];
                for(let rVarSub in subdep){
                    // dependency_relations[variable][rVarSub] = dependency_relations[rVar][rVarSub];
                    if(!dependency_relations[variable].has(rVarSub)){
                        dependency_relations[variable][rVarSub] = dependency_relations[rVar][rVarSub];
                    }else{
                        for(let id in dependency_relations[rVar][rVarSub]){
                            if(!dependency_relations[variable][rVarSub].includes(id)){
                                dependency_relations[variable][rVarSub].push(id);
                            }
                        }
                    }
                }
            }
        }
    },

    reachStableForDependency: function (map1, map2) {
        for(let k in map1){
            let subMap1 = map1[k];
            let subMap2 = map2[k];
            for(let variable in subMap1){
                if(variable in subMap2){
                    continue;
                }else{
                    return false;
                }

            }
            for(let variable in subMap2){
                if(variable in subMap1){
                    continue;
                }else{
                    return false;
                }
            }
        }
        return true;
    },

    raw_exists: function (block1, block2, functionDFG) {
        let paths = Analyzer.getAllPaths(block1, block2, functionDFG);
        let read_vars_in_block2 = Object.keys(functionDFG[block2]["readVars"]);
        let res = [false];
        //console.log("Read vars in 2nd block: "+read_vars_in_block2);
        for(let i=0; i < paths.length; i++){
            let curPath = paths[i];
            let pathBlocks = curPath.split(" ");
            for(let j=pathBlocks.length-2; j>=0 ; j--){
                let prev_block = pathBlocks[j];
                for(let index in read_vars_in_block2){
                    if(functionDFG[prev_block]["assignVars"][read_vars_in_block2[index]] != undefined){
                        res[0] = true;
                        res.push([read_vars_in_block2[index], prev_block, block2]);
                    }
                }
            }
        }
        return res;
    },

    getAllPaths: function (blcok1, block2, functionDFG) {
        let paths = [];
        let path = blcok1;
        Analyzer.dfs(blcok1, block2, functionDFG, paths, path);
        return paths;
    },

    dfs: function (block1, block2, functionDFG, paths, path) {
        if(block1 == block2){
            paths.push(path);
            return;
        }
        let postBlocks = functionDFG[block1].postBlocks;
        for(let nextBlock in postBlocks){
            let next_path = path + " " +nextBlock;
            Analyzer.dfs(nextBlock, block2, functionDFG, paths, next_path);
        }
    },

    waw_exists: function (externalCall, stateVarAssignment, functionDFG, ast){
        let res = [false];
        let paths = Analyzer.getAllPaths(externalCall, stateVarAssignment, functionDFG);
        let assignedVars = Object.keys(functionDFG[stateVarAssignment]["assignVars"]);
        //add state var assignments in external or internal function calls
        if(functionDFG[stateVarAssignment].type == "FunctionCall"){
            let map = Analyzer.getGlobalVaraibleModifyMap(ast);
            let funcCall = transformer.findNodeById(ast, stateVarAssignment);
            let funcString = funcCall.expression.name;
            let contracts = transformer.findNodeByType(ast, "ContractDefinition");
            let contract = null;
            for(let index in contracts){
                if(contracts[index].id < funcCall.id){
                    let get = false;
                    for(let i in contracts[index].subNodes){
                        if(contracts[index].subNodes[i].name == funcString){
                            contract = contracts[index];
                            get = true;
                            break;
                        }
                    }
                    if(get == true){
                        break;
                    }
                }
            }
            if(contract != null){
                for(let index in map[contract.name][funcString]){
                    if(map[contract.name][funcString][index].indexOf(assignedVars) == -1){
                        assignedVars.push(map[contract.name][funcString][index]);
                    }
                }
            }
        }
        for(let i = 0; i < paths.length; i++){
            let curPath = paths[i];
            let pathBlocks = curPath.split(" ");
            for(let j = pathBlocks.length - 2; j >= 0; j--){
                for(let index in assignedVars){
                    if(functionDFG[pathBlocks[j]]["assignVars"][assignedVars[index]] != undefined){
                        res[0] = true;
                        res.push([assignedVars[index], pathBlocks[j], stateVarAssignment]);
                    }
                }
            }
        }
        //console.log(res);
        return res;
    },

    war_exists: function (externalCall, stateVarAssignment, functionDFG, ast){
        let res = [false];
        let paths = Analyzer.getAllPaths(externalCall, stateVarAssignment, functionDFG);
        let assignedVars = Object.keys(functionDFG[stateVarAssignment]["assignVars"]);
        //add state var assignments in external or internal function calls
        if(functionDFG[stateVarAssignment].type == "FunctionCall"){
            let map = Analyzer.getGlobalVaraibleModifyMap(ast);
            let funcCall = transformer.findNodeById(ast, stateVarAssignment);
            let funcString = funcCall.expression.name;
            let contracts = transformer.findNodeByType(ast, "ContractDefinition");
            let contract = null;
            for(let index in contracts){
                if(contracts[index].id < funcCall.id){
                    let get = false;
                    for(let i in contracts[index].subNodes){
                        if(contracts[index].subNodes[i].name == funcString){
                            contract = contracts[index];
                            get = true;
                            break;
                        }
                    }
                    if(get == true){
                        break;
                    }
                }
            }
            if(contract != null){
                for(let index in map[contract.name][funcString]){
                    if(map[contract.name][funcString][index].indexOf(assignedVars) == -1){
                        assignedVars.push(map[contract.name][funcString][index]);
                    }
                }
            }
        }
        for(let i = 0; i < paths.length; i++){
            let curPath = paths[i];
            let pathBlocks = curPath.split(" ");
            for(let j = pathBlocks.length - 2; j >= 0; j--){
                for(let index in assignedVars){
                    if(functionDFG[pathBlocks[j]]["readVars"][assignedVars[index]] != undefined){
                        res[0] = true;
                        res.push([assignedVars[index], pathBlocks[j], stateVarAssignment]);
                    }
                }
            }
        }
        //console.log(res);
        return res;
    },

    findStateVarsAssignments: function(ast, externalCall, funcNode){
        let functionDFG = dfg.generate(ast, funcNode);
        let additionalStateVar = [];
        for(let index in dfg.varReferences){
            for(let i in dfg.varReferences[index]){
                if(dfg.varReferences[index][i][1] == true){
                    for(let j in dfg.varReferences[index]){
                        additionalStateVar.push(j);
                    }
                }
            }
        }
        let worklist = [externalCall.id];
        let assignments = [];
        while(worklist.length != 0){
            for(let i in functionDFG[worklist[0]]["postBlocks"]){
                if(worklist.indexOf(i) == -1)
                    worklist.push(i);
            }
            if(worklist[0] != externalCall.id){
                let pushed = false;
                for(let i in functionDFG[worklist[0]]["assignVars"]){
                    if(functionDFG[worklist[0]]["assignVars"][i][1] == true 
                    || additionalStateVar.indexOf(i) != -1
                    || (functionDFG[worklist[0]]["assignVars"][i][0] instanceof Array 
                    && additionalStateVar.indexOf(functionDFG[worklist[0]]["assignVars"][i][0][1]) != -1)){
                        if(assignments.indexOf(worklist[0]) == -1){
                            assignments.push(worklist[0]);
                            pushed = true;
                        }
                    }
                }
                //add function call
                if(pushed == false){
                    let map = Analyzer.getGlobalVaraibleModifyMap(ast);
                    let funcCallStat = transformer.findNodeById(ast, worklist[0]);
                    let funcCalls = transformer.findNodeByType(funcCallStat, "FunctionCall");
                    let funcCall = null;
                        for(let i in funcCalls){
                            if(funcCalls[i].depth == funcCallStat.depth + 1){
                                funcCall = funcCalls[i];
                            }
                        }
                    if(funcCall != null){
                        let contracts = transformer.findNodeByType(ast, "ContractDefinition");
                        let contract = null;
                        let funcString = null;
                        if(funcCall.expression.type == "Identifier"){
                            funcString = funcCall.expression.name;
                        }
                        for(let index in contracts){
                            if(contracts[index].id < funcCall.id){
                                let get = false;
                                for(let i in contracts[index].subNodes){
                                    if(contracts[index].subNodes[i].name == funcString){
                                        contract = contracts[index];
                                        get = true;
                                        break;
                                    }
                                }
                                if(get == true){
                                    break;
                                }
                            }
                        }
                        //this mean the function call is external
                        if(contract == null || map[contract.name][funcString] == undefined){
                            if(funcString != null && assignments.indexOf(worklist[0]) == -1){
                                assignments.push(worklist[0]);
                                pushed = true;
                            }
                        }
                        //this means the function call is internal
                        else if(map[contract.name][funcString].length != 0){
                            if(assignments.indexOf(worklist[0]) == -1){
                                assignments.push(worklist[0]);
                                pushed = true;
                            }
                        }
                    }
                    
                }
            }
            worklist.splice(0,1);
        }
        return assignments;
    },

    singleStatementDep: function(statement, functionDFG) {
        let worklist = [statement];
        let readVars = functionDFG[statement]["readVars"];
        let assignVars = functionDFG[statement]["assignVars"];
        while (worklist.length != 0) {
            for (let i in functionDFG[worklist[0]]["postBlocks"]) {
                if (worklist.indexOf(i) == -1)
                    worklist.push(i);
            }
            if (worklist[0] != statement) {
                for (let i in readVars) {
                    if (functionDFG[worklist[0]]["assignVars"][i] != undefined) {
                        return true;
                    }
                }
                for (let i in assignVars) {
                    if (functionDFG[worklist[0]]["readVars"][i] != undefined || functionDFG[worklist[0]]["assignVars"][i] != undefined) {
                        return true;
                    }
                }
            }
            worklist.splice(0, 1);
        }
        return false;
    },

    getContractNames: function (ast) {
        let contractName = [];
        for(let i=0; i < ast["children"].length; i++){
            if(("kind" in ast["children"][i]) && ast["children"][i]["kind"] =="contract"){
                contractName.push(ast["children"][i]["name"]);
            }
        }
        return contractName;
    },

    /*
    * ast : abstract syntax tree
    * contractName: the name of contract
    * return: a list of function name belongs to the given contract
    * */
    getFunctionsBelongToContract: function(ast, contractName) {
        let functions = [];
        for(let i=0; i < ast["children"].length; i++){
            if(!Analyzer.contract_match_or_not(ast["children"][i], contractName)){
                continue;
            }
            let subNodes = ast["children"][i]["subNodes"];
            for(let j=0; j < subNodes.length; j++){
                let node = subNodes[j];
                if(("type" in node) && node["type"] == "FunctionDefinition"){
                    functions.push(node["name"]);
                }
            }
        }
        return functions;
    },

    getGlobalStateVariable: function(ast, contractName){
        let globalVariables = [];
        for(let i=0; i < ast["children"].length; i++){
            if(!Analyzer.contract_match_or_not(ast["children"][i], contractName)){
                continue;
            }
            let subNodes = ast["children"][i]["subNodes"];
            for(let j=0; j < subNodes.length; j++){
                let node = subNodes[j];
                if(("type" in node) && node["type"] == "StateVariableDeclaration"){
                    let variables = node["variables"];
                    for(let t=0; t < variables.length; t++){
                        let variable = variables[t];
                        if("name" in variable ){
                            globalVariables.push(variable["name"]);
                        }
                    }
                }
            }
        }
        return globalVariables;
    },

    /*Input:
    * ast: abstract syntax tree of a contract
    * Return:
    * A map of modified variable
    *   key: contract name
    *   value: another map key is function name value is modified global variables
    * */
    getGlobalVaraibleModifyMap: function(ast) {
        let res = new Map();
        let subcontracts = Analyzer.getContractNames(ast);
        for(let i = 0; i < subcontracts.length; i++){
            let contract = subcontracts[i];
            res[contract] = new Map();
            let contractFunctions = Analyzer.getFunctionsBelongToContract(ast, contract);
            let contractGlobalVariables = Analyzer.getGlobalStateVariable(ast, contract);
            for(let j=0; j<contractFunctions.length; j++){
                let function_name = contractFunctions[j];
                if(function_name == null)
                    continue;
                let functionNode = transformer.findFunction(ast, 1, function_name);
                let functionDFG = dfg.generate(ast, functionNode);
                let functionModifiedGloablVars = Analyzer.findModifiedGlobalVariables(functionDFG, contractGlobalVariables);
                res[contract][function_name] = functionModifiedGloablVars;
            }
        }
        return res;

    },
    /*
    * Inpurt:
    * functionDFG: the dfg graph of the function
    * globalVariables: the global varibales of the specific contract
    * Return:
    * a list of modified global variables
    * */
    findModifiedGlobalVariables: function(functionDFG, globalVariables){
        let res = [];
        for(let block in functionDFG){
            let write_vars = Object.keys(functionDFG[block]["assignVars"]);
            for(let variable in write_vars){
                if(globalVariables.indexOf(write_vars[variable])>=0 && res.indexOf(write_vars[variable]) == -1){
                    res.push(write_vars[variable]);
                }
            }
        }
        return res;
    },

    contract_match_or_not: function(children_obj, contractName){
        return ("kind" in children_obj) && children_obj["kind"] == "contract" &&
        children_obj["name"] == contractName;
    }
};




module.exports = Analyzer;