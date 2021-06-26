const fs = require("fs");

let reportparser = {
    getFileName:(output) => {
        try{
            var filename = [];
            for(let contract in output){
                let head = contract.lastIndexOf("/");
                let tail = contract.lastIndexOf(".sol:");
                let name = contract.substring(head+1, tail);
                if(filename.indexOf(name) == -1){
                    filename.push(name);
                }
            }
            return filename;
        }catch(err){
            console.log("Unable to get the filename.\n", err);
        }
    },
    getContracts:(output) => {
        try{
            var contracts = [];
            for(let contract in output){
                let head = contract.lastIndexOf(".sol:");
                let contractName = contract.substring(head+5, contract.length);
                if(contracts.indexOf(contractName) == -1){
                    contracts.push(contractName);
                }
            }
            return contracts;
        }catch(err){
            console.log("Unable to get the contract names.\n", err);
        }
    },
    getViolations:(output, contractName) => {
        try{
            var violations = {};
            for(let contract in output){
                if(contract.indexOf(contractName) != -1){
                    for(let vulnerability in output[contract]["results"]){
                        violations[vulnerability] = output[contract]["results"][vulnerability]["violations"];
                    }
                }
            }
            return violations;
        }catch(err){
            console.log("Unable to get the violations of this contract.\n", err);
        }
        
    },
    getContractsAndViolations:(output) => {
        try{
            var violations = {};
            for(let contract in output){
                let head = contract.lastIndexOf(".sol:");
                let contractName = contract.substring(head+5, contract.length);
                violations[contractName] = {};
                for(let vulnerability in output[contract]["results"]){
                    violations[contractName][vulnerability] = output[contract]["results"][vulnerability]["violations"];
                }
            }
            return violations;
        }catch(err){
            console.log("Unable to get all violations.\n", err);
        }
    },
    getTotalViolationNum:(output) => {
        try{
            var num = {};
            num["total"] = 0;
            for(let contract in output){
                for(let vulnerability in output[contract]["results"]){
                    if(num[vulnerability] == undefined){
                        num[vulnerability] = 0;
                    }
                    num["total"] = num["total"] + output[contract]["results"][vulnerability]["violations"].length;
                    num[vulnerability] = num[vulnerability] + output[contract]["results"][vulnerability]["violations"].length;
                }
            }
            return num;
        }catch(err){
            console.log("Unable to get total number of violations.\n", err);
        }
    },
    getOneViolation: (violationName, violations) => {
        try{
            let newviolations = [];
            for(let i in violations){
                for(let k in violations[i][violationName]){
                    newviolations.push(violations[i][violationName][k] + 1);
                }
            }
            return newviolations;
        }catch(err){
            console.log("Unable to get the single violation record.\n", err);
        }
    }
}

module.exports = reportparser;

//console.log(reportparser.getContractsAndViolations(output));