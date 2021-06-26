const appRoot = require("app-root-path");
const parser = require(appRoot + "/src/solidity-parser-antlr/src/index");
const fs = require("fs");
const utils = require(appRoot + "/src/utils");
const reportparser = require(appRoot + "/src/SecurifyReportParser");



var res_folder = "/home/pxf109/ContractDetect_slither/reports/securify-reports-processed-by-voting";

var securify_report_folder = '/home/pxf109/smartfix/securify-results/results';
var combine_result_folder = '/home/pxf109/ContractDetect_slither/reports/combine-results';
var securify_report_list = fs.readdirSync(securify_report_folder);
var combine_result_list = fs.readdirSync(combine_result_folder);


for (let i = 0; i < combine_result_list.length; i++) {
    var combine_result_name = combine_result_list[i];
    var address = combine_result_name.split('-')[0];
    var securify_result_name = address+".json";
    var combine_result_abs_path = combine_result_folder+"/" + combine_result_name;
    var securify_report_abs_path = securify_report_folder+"/"+securify_result_name;
    var securify_pure_output = JSON.parse(fs.readFileSync(securify_report_abs_path));
    var combine_res = JSON.parse(fs.readFileSync(combine_result_abs_path));
     processOriginalSecurifyBasedOnMultipleDetector(securify_pure_output, combine_res, address);
    var final_report_path = res_folder +"/"+address+"-final.json"
    fs.writeFile(final_report_path, JSON.stringify(securify_pure_output), function(err) {
        if (err) {
            console.log(err);
        }
    });
}

function processOriginalSecurifyBasedOnMultipleDetector(securifyRes, multiepleRes, address){
    for(let contract in securifyRes) {
        if (contract.indexOf(address)!=-1) {
            for (let vulnerability in securifyRes[contract]['results']) {
                if (vulnerability == "DAO") {
                    // utils.printPretty(securifyRes[contract]['results'][vulnerability]);
                    var violations = securifyRes[contract]['results'][vulnerability]['violations'];
                    var multiple_res = multiepleRes["DAO"];
                    if(violations.length > 0) {
                        console.log(address + " " + "Previous violations:" + violations.toString());
                        var modified_violation = []
                        for (let i = 0; i < violations.length; i++) {
                            var vulner_line = violations[i] + 1;      //Securify json report line number start from zero
                            if (vulner_line in multiple_res && multiple_res[vulner_line]>1) {
                                modified_violation.push(violations[i]);
                            }
                        }
                        if (modified_violation.length != violations.length){
                            securifyRes[contract]['results'][vulnerability]['violations'] = modified_violation;
                        }
                        console.log(address+" "+ "fianl violations: "+ securifyRes[contract]['results'][vulnerability]['violations'].toString());
                    }
                }
            }
        }
    }
}
