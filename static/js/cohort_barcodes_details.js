/**
 *
 * Copyright 2017, Institute for Systems Biology
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

require.config({
    baseUrl: STATIC_FILES_URL+'js/',
    paths: {
        jquery: 'libs/jquery-1.11.1.min',
        bootstrap: 'libs/bootstrap.min',
        jqueryui: 'libs/jquery-ui.min',
        session_security: 'session_security',
        underscore: 'libs/underscore-min',
        ajv: 'libs/ajv.bundle',
        base: 'base'
    },
    shim: {
        'bootstrap': ['jquery'],
        'jqueryui': ['jquery'],
        'session_security': ['jquery'],
        'base': ['jquery', 'jqueryui', 'session_security', 'bootstrap', 'underscore']
    }
});

require([
    'jquery',
    'jqueryui',
    'bootstrap',
    'session_security',
    'underscore',
    'base',
    'ajv'
], function ($, jqueryui, bootstrap, session_security, _, base, ajv) {

    var savingChanges = false;
    var validated_barcodes = null;

    // Used for getting the CORS token for submitting data
    function get_cookie(name) {
        var cookieValue = null;
        if (document.cookie && document.cookie != '') {
            var cookies = document.cookie.split(';');
            for (var i = 0; i < cookies.length; i++) {
                var cookie = jQuery.trim(cookies[i]);
                // Does this cookie string begin with the name we want?
                if (cookie.substring(0, name.length + 1) == (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function validateJson(json) {
        var jv = new ajv();
        var validator = jv.compile(base.gdcSchema);

        var validate = validator(json);

        if(!validate) {
            return validator.errors;
        }
        return null;
    };

    function validateEntries(barcodes,preFormatted) {

        var result = {
            valid_entries: null,
            invalid_entries: null
        };

        if(!preFormatted) {
            var case_id_col = 0;
            var proj_col = 0;
            var isGdcTsv = false;
            if(barcodes[0].match(/Project/) && barcodes[0].match(/Case ID/) && barcodes[0].match(/\t/)) {
                isGdcTsv = true;
                var header_cols = barcodes[0].split(/\s*\t\s*/);
                for(var i=0; i<header_cols.length; i++) {
                    if(header_cols[i] == 'Case ID') {
                        case_id_col = i;
                    }
                    if(header_cols[i] == 'Project') {
                        proj_col = i;
                    }
                }
                barcodes.shift();
            }
            barcodes.filter(function(barcode){ return barcode !== ""; }).map(function(barcode) {
                // Split the entry into its values
                barcode = barcode.trim();
                var entry_split = null;
                if(isGdcTsv) {
                    entry_split = barcode.split(/\s*\t\s*/);
                }
                if ((isGdcTsv && entry_split.length < 2) || barcode.length <= 0) {
                    if (!result.invalid_entries) {
                        result.invalid_entries = [];
                    }
                    result.invalid_entries.push(barcode);
                } else {
                    if (!result.valid_entries) {
                        result.valid_entries = [];
                    }
                    if(isGdcTsv) {
                        result.valid_entries.push(entry_split[case_id_col] + "{}{}" + entry_split[proj_col].split(/^([^-]+)-.+/)[1]);
                    } else {
                        // Strip any surrounding double or single quotes
                        barcode = barcode.replace(/["']/g,"");
                        // Determine the barcode type (case or sample) and program
                        var barcode_split = barcode.split("-");
                        // If the program segment of the barcode is ambiguous,
                        // this is probably a CCLE case barcode, otherwise
                        // we can easily identify it. Default to CCLE in such
                        // cases.
                        var program = "CCLE";
                        var case_barcode="",sample_barcode="";
                        if(PROGRAM_PREFIXES[barcode_split[0]]) {
                            program = barcode_split[0];
                        }
                        if(program == 'CCLE') {
                            if(barcode.startsWith("CCLE-")) {
                                sample_barcode = barcode;
                            } else {
                                case_barcode = barcode;
                            }
                        } else {
                            if(barcode_split.length == 3) {
                                case_barcode = barcode;
                            }
                            if(barcode_split.length == 4) {
                                sample_barcode = barcode;
                            }
                        }
                        result.valid_entries.push(case_barcode + "{}" + sample_barcode + "{}" + program);
                    }
                }
            });
        } else {
            result.valid_entries = barcodes;
        }

        // Any entries which were valid during the initial parse must now be checked against the database
        if(result.valid_entries) {
            var deferred = $.Deferred();
            var csrftoken = get_cookie('csrftoken');
            $.ajax({
                type        : 'POST',
                dataType    :'json',
                url         : BASE_URL + '/cohorts/validate_barcodes/',
                data        : JSON.stringify({'barcodes' : result.valid_entries}),
                beforeSend  : function(xhr){xhr.setRequestHeader("X-CSRFToken", csrftoken);},
                success : function (data) {
                    result.valid_entries = data.valid_entries && data.valid_entries.length > 0 ? data.valid_entries : null;
                    if(data.invalid_entries && data.invalid_entries.length > 0) {
                        if (!result.invalid_entries) {
                            result.invalid_entries = data.invalid_entries;
                        } else {
                            result.invalid_entries.concat(data.invalid_entries);
                        }
                        if(data.messages) {
                            result.messages = data.messages;
                        }
                    }
                    result.counts = data.counts;
                    result.valid_entries && deferred.resolve(result);
                    !result.valid_entries && deferred.reject(result);
                },
                error: function (data) {
                    // If no valid barcodes were found we wind up here
                    deferred.reject(data);
                }
            });
            return deferred;
        } else {
            return $.Deferred().reject(result);
        }
    }

    // Basic filtering for tsv or csv format, correct number of columns (including empties), and allowed characters
    function checkContentValidity(contents) {
        // Do a rough file content validation
        var tsvMatch = contents.match(/\t/g);
        var csvMatch = contents.match(/,/g);
        var dQuoteMatch = contents.match(/"/g);
        var sQuoteMatch = contents.match(/'/g);
        var whitelistMatch = contents.match(base.barcode_file_whitelist);

        // Content rules:
        // - A file cannot have both tabs and commas, or, if it does, there must be an even number of double or single quotes (to surround the tab or comma in the value)
        // - A file must have an even number of single and/or double quotes
        // - A file must only have characters present on the whitelist

        return !(
            (tsvMatch && csvMatch && ((sQuoteMatch && sQuoteMatch.length <= 0 && dQuoteMatch && dQuoteMatch.length <= 0)
                || (dQuoteMatch && dQuoteMatch.length % 2 != 0 && sQuoteMatch && sQuoteMatch.length % 2 != 0)))
            || whitelistMatch);
    }

    // Text-area paste
    $('#enter-barcodes button.verify').on('click',function(){
        $('.verify-pending').css('display','inline-block');
        var content = $('#enter-barcodes textarea').val();

        if(!checkContentValidity(content)) {
            base.showJsMessage("error","The entered set of barcodes is not properly formatted. Please double-check that they are in tab- or comma-delimited format.",true);
            return false;
            $('.verify-pending').hide();
        } else {
            $('.alert-dismissible button.close').trigger('click');
        }

        var entries = [];
        var tsvMatch = content.match(/\t/g);
        var csvMatch = content.match(/,/g);
        var nsvMatch = content.match(/\n/g);

        var nl_split_entries = content.split('\n');

        if(tsvMatch) {
            if(nsvMatch) {
                for(var i=0; i<nl_split_entries.length; i++) {
                    entries = entries.concat(nl_split_entries[i].split(/\s*\t(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/));
                }
            } else {
                entries = content.split(/\s*\t(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/);
            }
        } else if(csvMatch) {
            if(nsvMatch) {
                for(var i=0; i<nl_split_entries.length; i++) {
                    entries = entries.concat(nl_split_entries[i].split(/\s*,(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/));
                }
            } else {
                entries = content.split(/\s*,(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/);
            }
        } else if(nsvMatch) {
            entries = nl_split_entries;
        }

        // Validate the entries
        validateEntries(entries).then(
            function(result){
                $('.verify-pending').hide();
                showEntries(result, $('#enter-barcodes'));
                $('#enter-barcodes .save-cohort button').removeAttr('disabled');
                $('#enter-barcodes .save-cohort').show();
            },function(result){
                $('.verify-pending').hide();
                // We only reach this point if no entries are valid, so show an error message as well.
                base.showJsMessage("error","None of the supplied barcode entries were valid. Please double-check the format of your entries.",true);
                showEntries(result.responseJSON,$('#enter-barcodes'));
                fileUploadField.val("");
                $('#enter-barcodes .save-cohort button').attr('disabled','disabled');
                $('#enter-barcodes .save-cohort').hide();
            }
        );
    });


    // File Upload
    var xhr2 = !! ( window.FormData && ("upload" in ($.ajaxSettings.xhr())  ));
    if(!xhr2 || !window.File || !window.FileReader || !window.FileList || !window.Blob){
        var errorMsg = 'Your browser doesn\'t support file upload. Please use the \'Entry\' method instead.';
        $('#file-upload-btn').attr('disabled', true).parent()
                             .append('<p class="small">' + errorMsg + '</p>');
    } else {
        // If file upload is supported
        var fileUploadField = $('#file-upload-field');
        var validFileTypes = ['txt', 'csv', 'tsv', 'json'];

        $('#file-upload-btn').click(function(event){
            event.preventDefault()
            fileUploadField.click();
            $('.alert-dismissible button.close').trigger('click');
            $('.barcode-status').hide();
            $('#upload .save-cohort').attr('disabled','disabled');
        });

        fileUploadField.on('change', function(event){
            var file = this.files[0];
            var ext = file.name.split(".").pop().toLowerCase();

            // check file format against valid file types
            if(validFileTypes.indexOf(ext) < 0){
                // If file type is not correct
                base.showJsMessage("error","Please choose a .txt, .tsv, .csv, or .json file.",true);
                fileUploadField.val("");
                return false;
            } else{
                $('#selected-file-name').text(file.name);
                $('#uploading').addClass('in');
                $('#file-upload-btn').hide();
            }

            if(event.target.files != undefined){
                var fr = new FileReader();
                fr.onload = function(event){
                    var isGdcJson = fr.result.match(/submitter_id/);
                    var isGdcTsv = fr.result.match(/Case ID/) && fr.result.match(/Project/) && fr.result.match(/\t/);
                    var entries = null;
                    var isPreFormatted = false;
                    var msg = null;
                    // GDC JSON file
                    if(isGdcJson) {
                        var parsedJson = null;
                        try {
                            parsedJson = JSON.parse(fr.result);
                        } catch (e) {
                            parsedJson = null;
                        }

                        if(!parsedJson) {
                            msg = "This file does not contain valid JSON. Please double-check its format.";
                        } else {
                            var checkJson = validateJson(parsedJson);
                            if (checkJson) {
                                msg = "This file is not in a valid GDC JSON case manifest format. Please double-check your file. The following errors were found: ";
                                msg += checkJson[0].message.replace("should have", "missing");
                            }
                        }
                    // GDC TSV case manifest
                    } else if(isGdcTsv) {
                        if(!(fr.result.match(/\t/g).length >= 2)) {
                            msg = "This file is not in a valid GDC TSV case manifest format. Please double-check the file, and be sure the header row, Project column, and Case ID column were included."
                        }
                    // tab/comma delimited barcode list
                    } else if(!checkContentValidity(fr.result)) {
                        msg = "This file is not in a valid format. Please supply a JSON, comma-delimited, or tab-delimited file in an appropriate format as specified in the Instructions.";
                    }

                    if(msg) {
                        base.showJsMessage("error",msg,true);
                        $('#uploading').removeClass('in');
                        $('#file-upload-btn').show();
                        fileUploadField.val("");
                        return false;
                    }

                    if(isGdcJson) {
                        var gdcSet = JSON.parse(fr.result);
                        var entries = [];
                        for(var i=0; i < gdcSet.length; i++) {
                            entries.push(gdcSet[i]['submitter_id']+"{}{}"+gdcSet[i]['project']['project_id'].split(/^([^-]+)-.+/)[1])
                        }
                        isPreFormatted = true;
                    } else if(isGdcTsv) {
                        entries = fr.result.split('\n');
                    } else {
                        var tsvMatch = fr.result.match(/\t/g);
                        var csvMatch = fr.result.match(/,/g);
                        var nsvMatch = fr.result.match(/\n/g);

                        var nl_split_entries = fr.result.split('\n');

                        if(tsvMatch) {
                            if(nsvMatch) {
                                entries = [];
                                for(var i=0; i<nl_split_entries.length; i++) {
                                    entries = entries.concat(nl_split_entries[i].split(/\s*\t(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/));
                                }
                            } else {
                                entries = fr.result.split(/\s*\t(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/);
                            }
                        } else if(csvMatch) {
                            if(nsvMatch) {
                                entries = [];
                                for(var i=0; i<nl_split_entries.length; i++) {
                                    entries = entries.concat(nl_split_entries[i].split(/\s*,(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/));
                                }
                            } else {
                                entries = fr.result.split(/\s*,(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)\s*/);
                            }
                        } else if(nsvMatch) {
                            entries = nl_split_entries;
                        }
                    }

                    $('#file-upload-btn').attr('disabled','disabled');
                    $('.verify-pending').css('display','inline-block');

                    // Validate the entries
                    validateEntries(entries,isPreFormatted).then(
                        function(result){
                            showEntries(result, $('#upload-file'));
                            $('#upload-file .save-cohort button').removeAttr('disabled');
                            $('#upload-file .save-cohort').show();
                            $('.verify-pending').hide();
                            $('#file-upload-btn').removeAttr('disabled');
                        },function(result){
                            // We only reach this point if no entries are valid, so show an error message as well.
                            base.showJsMessage("error","None of the supplied barcode entries were valid. Please double-check the format of your entries.",true);
                            showEntries(result.responseJSON,$('#upload-file'));
                            fileUploadField.val("");
                            $('#upload-file .save-cohort button').attr('disabled','disabled');
                            $('#upload-file .save-cohort').hide();
                            $('.verify-pending').hide();
                            $('#file-upload-btn').removeAttr('disabled');
                        }
                    );
                    $('#uploading').removeClass('in');
                    $('#file-upload-btn').show();
                    fileUploadField.val("");
                }

                fr.readAsText(event.target.files.item(0));
                fileUploadField.val("");
            }
        })
    }

    function showEntries(result, tab) {
        tab.find('.invalid-entries pre').empty();
        tab.find('.valid-entries pre').empty();
        if(result.invalid_entries && result.invalid_entries.length > 0) {
            tab.find('.validation-messages ul').empty();
            var entry_set = "";
            for(var i=0; i < result.invalid_entries.length; i++) {
                var entry = result.invalid_entries[i];
                entry_set += (
                    (entry['case'].indexOf(",") < 0 ? entry['case'] : '"' + entry['case'] + '"')
                    +", "
                    +(entry['sample'].indexOf(",") < 0 ? entry['sample'] : '"' + entry['sample'] + '"')
                    +", "+entry['program']+'\n'
                );
            }
            tab.find('.invalid-entries pre').html(entry_set);
            if(result.messages) {
                var msg_set = "";
                for(var i=0; i < result.messages.length; i++) {
                    tab.find('.validation-messages ul').append('<li>'+result.messages[i]+'</li>')
                }
                tab.find('.validation-messages').show();
            } else {
                tab.find('.validation-messages').hide();
            }
            tab.find('.invalid-entries').show();
        } else {
            tab.find('.invalid-entries').hide();
            tab.find('.invalid-not-saved').hide();
        }

        if(result.valid_entries && result.valid_entries.length > 0) {
            var entry_set = "";
            validated_barcodes = [];
            for(var i=0; i < result.valid_entries.length; i++) {
                var entry = result.valid_entries[i];
                entry_set += (
                    (entry['case'].indexOf(",") < 0 ? entry['case'] : '"' + entry['case'] + '"')
                    +", "
                    +(entry['sample'].indexOf(",") < 0 ? entry['sample'] : '"' + entry['sample'] + '"')
                    +", "+entry['program']+'\n'
                );
                validated_barcodes.push({'sample_barcode': entry['sample'], 'case_barcode': entry['case'], 'program': entry['program_id'], 'project': entry['project']});
            }
            tab.find('.valid-entries pre').html(entry_set);
            tab.find('.valid-entries input').remove();
            tab.find('.valid-entries').show();
            tab.find('.cohort-counts tbody').empty();
            for(var i = 0; i < result.counts.length; i++) {
                var prog_deets = result.counts[i];
                tab.find('.cohort-counts tbody').append('<tr><td>'+prog_deets['program']+'</td><td>'+prog_deets['samples']+'</td><td>'+prog_deets['cases']+'</td>');
            }
            tab.find('.cohort-counts').show();
            result.invalid_entries && result.invalid_entries.length > 0 && tab.find('.invalid-not-saved').show();
        } else {
            tab.find('.valid-entries').hide();
            tab.find('.cohort-counts').hide();
            tab.find('.invalid-not-saved').hide();
        }
        tab.find('.barcode-status').show();
    }


    // Event bindings

    $('button.instructions').on('click',function(){
        $(this).siblings('div.instructions').is(':visible') ? $(this).siblings('div.instructions').hide() : $(this).siblings('div.instructions').show();
    });

    $('button[data-target="#create-cohort-modal"]').on('click',function(e){
        // Clear previous alerts
        $('#unallowed-chars-alert').hide();

        $('#cohort-counts-modal tbody').empty();
        $('.tab-pane.data-tab.active .cohort-counts tbody tr').each(function(){
            $('#cohort-counts-modal tbody').append($(this).clone());
        });

    });

    $('#create-cohort-form').on('submit', function(e) {

        $('#unallowed-chars-alert').hide();

        if(savingChanges) {
            e.preventDefault();
            return false;
        }

        var unallowed = $('#create-cohort-name').val().match(base.whitelist);
        if(unallowed) {
            $('.unallowed-chars').text(unallowed.join(", "));
            $('#unallowed-chars-alert').show();
            e.preventDefault();
            return false;
        }

        var form = $(this);

        savingChanges = true;

        form.append('<input type="hidden" name="apply-name" value="true" />');
        form.append('<input type="hidden" name="apply-barcodes" value="true" />');
        form.append($('<input>').attr({type: "hidden", name: "barcodes", value: JSON.stringify(validated_barcodes)}));

        $('#saving-cohort').css('display','inline-block');
    });

    $("#pasted-barcodes").keypress(function (e) {
        var str = $(this).val();
        if (str.length >= parseInt($("#pasted-barcodes").attr('maxlength'))) {
            e.preventDefault();
            base.showJsMessage("warning", "You have reached the maximum size of the text box.",true);
            return false;
        }
    });
});
