const appRoot = require("app-root-path");
const transformer = require(appRoot + "/src/ast-transformer");
const ad = require(appRoot + '/src/advancedtransformer');

postprocessor = {
    handleMissingInputValidation:(violations, ast) =>{
        try{
            res = [];
            for(let contract in violations){
                for(let line in violations[contract]["MissingInputValidation"]){
                    let funcs = transformer.findNodeByLine(ast, violations[contract]["MissingInputValidation"][line] + 1);
                    for(let func in funcs){
                        if(funcs[func].type == "FunctionDefinition" && funcs[func].loc.start.line == 
                        violations[contract]["MissingInputValidation"][line] + 1){
                            let pushed = false;
                            //when all parameters are address
                            let parameters = ad.getParameters(funcs[func]);
                            let addressnum = 0;
                            let nonaddresses = [];
                            //if this function has no parameter, skip
                            if(Object.keys(parameters).length == 0){
                                continue;
                            }
                            for(let parameter in parameters){
                                if(parameters[parameter] == "address"){
                                    addressnum = addressnum + 1;
                                }
                                else{
                                    nonaddresses.push(parameter);
                                }
                            }
                            //if there is no address parameters, skip
                            if(nonaddresses.length == Object.keys(parameters).length){
                                continue;
                            }
                            //check if these address parameters are validated
                            //find all require node
                            let funccalls = transformer.findNodeByType(funcs[func], "FunctionCall");
                            let requires = [];
                            for(let funccall in funccalls){
                                if(funccalls[funccall].expression.type == "Identifier" && funccalls[funccall].expression.name == "require"){
                                    requires.push(funccalls[funccall]);
                                }  
                            }
                            let addresschecked = 0;
                            for(let parameter in parameters){
                                if(parameters[parameter] == "address"){
                                    for(let scope in requires){
                                        if(requires[scope].arguments[0].type == "BinaryOperation" && requires[scope].arguments[0].left.type == "Identifier"
                                        &&  requires[scope].arguments[0].left.name == parameter){
                                            addresschecked = addresschecked + 1;
                                        }
                                    }
                                }
                            }
                            //if all address parameters are checked, skip
                            if(addressnum <= addresschecked){
                                continue;
                            }
                            if(addressnum == Object.keys(parameters).length && 
                            res.indexOf(violations[contract]["MissingInputValidation"][line] + 1) == -1 &&
                            addressnum > addresschecked){
                                res.push(violations[contract]["MissingInputValidation"][line] + 1);
                            }
                            //there are non-address parameters but they have already been validated
                            //check if non-address parameters have been validated
                            let checked = {};
                            for(let nonaddress in nonaddresses){
                                checked[nonaddresses[nonaddress]] = false;
                                for(let scope in requires){
                                    //remove require function calls
                                    let calls = transformer.findNodeByType(requires[scope], "FunctionCall");
                                    for(let call in calls){
                                        if(calls[call].expression.type == "Identifier" && calls[call].expression.name == "require"){
                                            calls.splice(call, 1);
                                        }
                                    }
                                    if(calls.length == 0
                                    && transformer.findNodeByName(requires[scope], nonaddresses[nonaddress]).length != 0){
                                        checked[nonaddresses[nonaddress]] = true;
                                    }
                                }
                            }
                            let skip = false;
                            for(let check in checked){
                                if(checked[check] == false){
                                    skip = true;
                                    break;
                                }
                            }
                            if(skip == true){
                                continue;
                            }
                            if(res.indexOf(violations[contract]["MissingInputValidation"][line] + 1) == -1){
                                res.push(violations[contract]["MissingInputValidation"][line] + 1);
                            }
                        }
                    }
                }
            }
            return res;
        }catch(err){
            console.log("Unable to process MissingInputVlidation vulnerabilities.\n", err);
        }
    },

    handleLockedEther:(violations, ast) =>{
        try{
            res = [];
            for(let contract in violations){
                for(let line in violations[contract]["LockedEther"]){
                    let funcs = transformer.findNodeByLine(ast, violations[contract]["LockedEther"][line] + 1);
                    for(let func in funcs){
                        if(funcs[func].type == "ContractDefinition" && funcs[func].loc.start.line == 
                        violations[contract]["LockedEther"][line] + 1 && funcs[func].kind == "contract"
                        && res.indexOf(violations[contract]["LockedEther"][line] + 1) == -1){
                            res.push(violations[contract]["LockedEther"][line] + 1);
                        }
                    }
                }
            }
            return res;
        }catch(err){
            console.log("Unable to process LockedEther vulnerabilities.\n", err);
        }
    },

    handleUnhandledException:(violations, ast) => {
        try{
            res= [];
            for(let contract in violations){
                for(let line in violations[contract]["UnhandledException"]){
                    let funcs = transformer.findNodeByLine(ast, violations[contract]["UnhandledException"][line] + 1);
                    for(let func in funcs){
                        if(funcs[func].type == "ExpressionStatement" && funcs[func].loc.start.line == 
                        violations[contract]["UnhandledException"][line] + 1){
                            //check whether the return value has been handled
                            let binops = transformer.findNodeByType(funcs[func], "BinaryOperation");
                            let checked = false;
                            for(let binop in binops){
                                if(binops[binop].operator == "="){
                                    checked = true;
                                }
                            }
                            if(checked){
                                continue;
                            }
                            if(res.indexOf(violations[contract]["UnhandledException"][line] + 1) == -1){
                                res.push(violations[contract]["UnhandledException"][line] + 1);
                            }
                        }
                    }
                }
            }
            return res;
        }catch(err){
            console.log("Unable to process UnhandledException vulnerabilities.\n", err);
        }
    },

    handleDAO: (violations, ast) => {
        try{
            res = [];
            for(let contract in violations){
                for(let line in violations[contract]["DAO"]){
                    let funcs = transformer.findNodeByLine(ast, violations[contract]["DAO"][line] + 1);
                    for(let func in funcs){
                        if(funcs[func].type == "ExpressionStatement" && funcs[func].loc.start.line == 
                        violations[contract]["DAO"][line] + 1 && funcs[func].expression.type == "FunctionCall"){
                            let globalfunc = transformer.findIncludedGlobalDef(ast, funcs[func]);
                            let assignments = transformer.findStateVariable(globalfunc, 4, funcs[func].id);
                            let statements = [];
                            statements = statements.concat(transformer.findNodeByType(globalfunc, "IfStatement"));
                            statements = statements.concat(transformer.findNodeByType(globalfunc, "DoWhileStatement"));
                            statements = statements.concat(transformer.findNodeByType(globalfunc, "WhileStatement"));
                            let notincluded = true;
                            //check if external call is included in if/do-while/while statements
                            let statementsFuncCalls = [];
                            let statementsBinops = [];
                            for(let statement in statements){
                                statementsFuncCalls = statementsFuncCalls.concat(transformer.findNodeByType(statements[statement], "ExpressionStatement"));
                                statementsBinops = statementsBinops.concat(transformer.findNodeByType(statements[statement], "BinaryOperation"));
                            }
                            for(let statementsFuncCall in statementsFuncCalls){
                                if(funcs[func] == statementsFuncCalls[statementsFuncCall]){
                                    notincluded = false;
                                }
                            }
                            if(notincluded == false){
                                continue;
                            }
                            for(let statementsBinop in statementsBinops){
                                for(let assignment in assignments){
                                    if(assignments[assignment] == statementsBinops[statementsBinop]){
                                        notincluded = false;
                                    }
                                }
                            }
                            if(notincluded == false){
                                continue;
                            }
                            //check if statevariable assignments are timestamp
                            let timestamp = false;
                            for(let assignment in assignments){
                                if(transformer.findNodeByName(assignments[assignment], "now").length != 0){
                                    timestamp = true;
                                }
                            }
                            if(timestamp == true){
                                continue;
                            }
                            if(res.indexOf(violations[contract]["DAO"][line] + 1) == -1){
                                res.push(violations[contract]["DAO"][line] + 1);
                            }
                        }
                    }
                }
            }
            return res;
        }catch(err){
            console.log("Unable to process DAO vulnerabilities.\n", err);
        }
    },

    handleUnrestrictedWrite: (violations, ast) => {
        res = [];
        return res;
    },

    handleAll: (violations, ast) => {
        let newviolations = {};
        newviolations["DAO"] = postprocessor.handleDAO(violations, ast);
        newviolations["UnhandledException"] = postprocessor.handleUnhandledException(violations, ast);
        newviolations["LockedEther"] = postprocessor.handleLockedEther(violations, ast);
        newviolations["MissingInputValidation"] = postprocessor.handleMissingInputValidation(violations, ast);
        newviolations["UnrestrictedWrite"] = postprocessor.handleUnrestrictedWrite(violations, ast);
        return newviolations;
    }
}

module.exports = postprocessor;
