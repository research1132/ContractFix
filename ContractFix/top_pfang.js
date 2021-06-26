const appRoot = require("app-root-path");
const parser = require(appRoot + "/src/solidity-parser-antlr/src/index");
const fs = require("fs");
const utils = require(appRoot + "/src/utils");
const reportparser = require(appRoot + "/src/SecurifyReportParser");
const postprocessor = require(appRoot + "/src/PostProcessor");
const fix = require(appRoot + "/src/fix");
const generator = require(appRoot + "/src/solidity-generator");



// var processedSecurifyReportFolder = "/home/pxf109/ContractDetect_slither/reports/securify-reports-processed-by-voting";
// var combinedResFolder = "/home/xxx/ContractDetect_slither/reports/combine-results";
// var vulContractFolders = ["/home/xxx/smartfix/real_contract_dataset/real_contracts_dataset_for_repair/Mixed"];
// var resFolder = "/home/xx/smartfix/mixed_after_postprocessing";

var combinedResFolder = process.argv[2];
var vulContractFolders = process.argv[3];
var resFolder = process.argv[4];



for (let index in vulContractFolders) {
    var vulContracts =  fs.readdirSync(vulContractFolders);
    for (let index2 in vulContracts){
        var contracrtName = vulContracts[index2];
        var contractAddress = contracrtName.split(".")[0];
        var combinResPath = combinedResFolder+"/"+contractAddress+"-combine.json";
        var combineJsonObj = JSON.parse(fs.readFileSync(combinResPath));
        var reportList = combineJsonObj["report_list"];
        var securifyReportPath = processedSecurifyReportFolder+"/"+contractAddress+"-final.json";
        var contractPath = vulContractFolders[index]+"/"+contracrtName;
        var text = utils.readContract(contractPath);
        console.log("Fixing "+ contractPath.toString());
        var ast = parser.parse(text, {loc: true, range: true});
        parser.setDepthAndID(ast, true, true);
        var output = JSON.parse(fs.readFileSync(securifyReportPath));
        var violations = reportparser.getContractsAndViolations(output);
        violations = postprocessor.handleAll(violations, ast);

        var res = []
        res = fix.fixAllWithReports(violations, ast, reportList);
        parser.setDepthAndID(ast, true, true);
        generator.run(ast, text);
        var fixPath = resFolder+"/"+contractAddress+"-fixed.sol";
        utils.writeContract(generator.text, fixPath);
    }
}