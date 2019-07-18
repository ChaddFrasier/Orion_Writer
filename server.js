/**
 * @file server.js 
 * @alias server
 * @run node server 
 * 
 * @author Chadd Frasier
 * @version 2.4.0
 * @description This is the driver for the Caption Writer server by USGS.
 * 
 * Date Created: 05/31/19
 * Last Modified: 07/17/19
 *
 * @todo 1 unit test all componets
 * 
 * @todo 2 use jimp to super impose icons on the images using pixel tracking technique
 *      @see https://www.chestysoft.com/imagefile/javascript/get-coordinates.asp for details on pixel tracking
 * 
 * @todo 3 maybe use jimp to render and zoom on the image 
 *      @see https://capstone-planet.slack.com/files/UCW41FR9A/FK7TUTY15/image.png (this link is for team members) for resize and superimposition
 *      @see https://www.geeksforgeeks.org/node-jimp-crop/ for cropping
 *     
 * @todo 4 get image page working again
 * 
 * @todo 7 image cropping with jimp
 * 
 * TODO: simplify the object code
 * @requires ./util.js {this needs to be in root of application because of ISIS Commands}
 * @requires ./js/cubeObj.js
 * 
 * Note: This server is only capable of running on a linux or mac operating systems
 */

 /** READ ME BEFORE EDITING
  * @fileoverview   07/17/19 
  * 
  *       Promises were used to let the appication work in a Syncronous manner which javascript is not build for. The data
  *     extraction and object creation should not be changed for this reason. If it is changed then the functions could
  *     be processed in the improper order and using Promises allows for exec calls to be remerged.
  *     
  *       Cookies are used to keep track of user file uploads and subsequent data responses. The user will recieve
  *     live notifications when files fail to upload and it will inform user of the issue that the server 
  *     is facing from their attemped upload. Cookies are very important as that is how we will be able to find the correct
  *     data in the instance array.
  * 
  *       Instances of cubeObjects will be saved into an array that the server holds so when a user moves to another page they will recieve
  *     the correct data from the server.
  * 
*/

// require dependencies
const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const jimp = require('jimp');
const exec = require('child_process').exec;
const fs = require('fs');
const cookieparser = require('cookie-parser');

// include custom utility functions
const util = require('./util.js');
const Cube = require('./js/cubeObj.js');

// start app env
var app = express();
// global instance array for cube objects
var cubeArray = [];

// use express upload and cookie parser
app.use(fileUpload());
app.use(cookieparser());

// set OS flag
var isWindows = process.platform === 'win32';

// give app access to routes
app.use("/css" , express.static("css"));
app.use("/images" , express.static("images"));
app.use("/csv" , express.static("csv"));
app.use("/js" , express.static("js"));
app.use("/tpl" , express.static("tpl"));
app.use("/pvl " , express.static("pvl"));

// start view engine
app.set('view engine', 'ejs');

// HTTP Handling Functions

/**
 * GET '/' 
 * 
 * remove the print.prt if it exists and render the page with the proper code
 */
app.get('/', function(request, response){
    console.log(request.path);
    
    // query for alert code
    let code = request.query.alertCode;
    
    // TODO: windows can't use the exec call
        // maybe create an admin reset function that cleans the server
    
    // clean print.prt files from isis3
    if( !isWindows ){
        exec('rm print.prt');
    }else{
        exec('del "print.prt"');
    }

    // render the index page w/ proper code
    if(code == undefined){
        response.render("index.ejs", {alertCode: 0});
    }else{
        response.render("index.ejs", {alertCode: code});
    }
});
 

/**
 * GET '/tpl'
 * 
 * Renders the basic page with the description file
 */ 
app.get('/tpl',function(request, response){
    // read and send the data in the form of ejs file
    fs.readFile('./tpl/description.tpl', function read(err, data) {
        if (err) {
            // throw the error if needed
            throw err;
        }
        // render the data
        response.render('tpl.ejs', {tplData:data});
    });
});


/**
 * POST '/upload'
 * 
 * allows file upload and data extraction to take place when upload button is activated
 */
app.post('/upload', function(request, response){
    console.log(request.path);

    // prepare the variables for response to user
    var templateText = '';
    var cubeFileData;
    
    // for testing only
    console.log('=================== New Upload ========================');

    // cube file section
    try{
        if(request.files == null ){
            // if no files uploaded
            console.log('User Error Upload a Cube File to begin');
            // redirect the user & alert they need a .cub
            response.redirect('/?alertCode=3');
            // end the response
            response.end();
        }
        // cube (.cub) file regexp
        else if(/^.*\.(cub|CUB)$/gm.test(request.files.uploadFile.name)){
            // get the file from request
            var cubeFile = request.files.uploadFile;
            
            // save the cube upload to upload folder
            cubeFile.mv('./uploads/' + cubeFile.name, function(err){
                // report error if it occurs
                if(err){
                    console.log('This Error could have been because "/uploads" folder does not exist');
                    return response.status(500).send(err);
                }
            });
           
            // create promises array for syncronous behavior
            let promises = [];

            // create the cookie instance for the user
            response.cookie('cubeFile', cubeFile.name, {expires: new Date(Date.now() + 900000), httpOnly: true});
            

            // make promise on the isis function calls
            promises.push(util.makeSystemCalls(cubeFile.name,
                path.join('.','uploads',cubeFile.name),
                   path.join('.','pvl',cubeFile.name.replace('.cub','.pvl')),
                   'images'));
              
            // when isis is done read the pvl file
             Promise.all(promises).then(function(){
                //console.log('server heard back from ISIS');
                //reset promises array
                promises = [];

                // make new promise on the data extraction functions
                promises.push(util.readPvltoStruct(cubeFile.name));

                // when the readPvltoStructf function resolves create data instance
                Promise.all(promises).then(function(cubeData){
                    console.log('server got data: \n');
                   
                    // create new cube object
                    var cubeObj = new Cube(cubeFile.name);

                    // add the cube instance to the cube array if it does not already exist
                    cubeArray = util.addCubeToArray(cubeObj,cubeArray);
                   
                    // save data to object using setter in class
                    cubeObj.data = JSON.parse(cubeData);
                    
                    // read the config file to get only important tags for webpage
                    let importantTagArr = util.configServer(fs.readFileSync(
                        path.join('.','cfg', 'config1.cnf'), {encoding: 'utf-8'}));

                    // obtain the data for the important tags
                    var impDataString = util.importantData(cubeObj.data, importantTagArr);

                    // save the important data values to object using setter
                    cubeObj.impData = JSON.parse(impDataString);

                    // template file section
                    try{
                        // regexp for verifying tpl file
                        if(/^.*\.(tpl)$/gm.test(request.files.templateFile.name)){
                            // get file object
                            let tplFile = request.files.templateFile;

                            // save to server
                            tplFile.mv('./tpl/'+tplFile.name, function(err){
                                // report any errors
                                if(err){
                                    return response.status(500).send(err);
                                }
                            });
                            // set output for template
                            templateText = tplFile.data.toString();
                        }
                        else{
                            console.log('Wrong file type for template');
                            // send the alert code and redirect
                            response.redirect('/?alertCode=2');
                            // end response
                            response.end();
                        }
                    }catch(err){
                        // tpl is null set default
                        templateText = fs.readFileSync('tpl/default.tpl', 'utf-8');
                    }

                    // get the csv string
                    let csv = util.getCSV(cubeObj.data);

                    // get name of csv and write it to the csv folder
                    let csvFilename = cubeObj.name.replace('.cub','.csv');
                    fs.writeFileSync(path.join('csv',csvFilename),csv,'utf-8');

                    // send response w/ all variables
                    response.render('writer.ejs',
                        { templateText: templateText, 
                        dictionaryString: impDataString,
                        wholeData: cubeObj.data,
                        csvString: csv }); 

                }).catch(function(err){
                    // catch any promise error
                    console.log('Promise Error Occured: ' + err);
                    response.write('<html>HORRIBLE ERROR</html>');
                });
            });
        }
        else{
            // wrong file type uploaded
            console.log('wrong file type uploaded for cube section');
            console.log('file name is: ' + request.files.uploadFile.name);
            // redirect with alert code
            response.redirect('/?alertCode=1');
            // end response
            response.end();
            }
    }catch(err){
        console.log('Fatal Error Occured');
        console.log(err);
        // alert 4 which should never happen in a successful run
        response.redirect('/?alertCode=4');
        // end response
        response.end();
    }
});



/**
 * POST '/csv'
 * 
 *  this post function is only for matching the csv file with the users cookie and send it for download  
 */
app.post('/csv', function(request,response){
    // send download file
    response.download(path.join('csv',request.cookies['cubeFile'].replace('.cub','.csv')),function(err){
        if(err){
            console.log('file was not sent successfully');
        }else{
            // file sent
            response.end();
        }
    });
});

/**
 * POST '/imageDownload'
 * 
 *  this post function is only for sending the basic image to the user as a download  
 */
app.post('/imageDownload', function(request,response){
    // send download file
    response.download(path.join('images',request.cookies['cubeFile'].replace('.cub','.png')),function(err){
        if(err){
            console.log('file was not sent successfully');
        }else{
            // file sent
            response.end();
        }
    });
});


/**
 * POST '/showImage'
 * 
 * renders the image page with needed data
 */
app.post('/showImage', function(request, response){
    //TODO: image page
    console.log(request.path);

    // prepare variables 
    var cookieval = request.cookies['cubeFile'];
    var imagepath;
    var data;

    if(cookieval != undefined){
        // get image name and path
        let image = util.getimagename(cookieval, 'png');
        imagepath = 'images/' + image;

        // search for data in array given by user cookie
        data = util.getObjectFromArray(cookieval, cubeArray);

        // if the data val is an error code then fail
        if(data < 1){
            console.log('Object Serch Failed');
            data = 'NONE';
        }else{
            // otherwise load the important data from the active object array into data variable
            data = data.impData;
        }
    }else{
        // image path could not be found
        imagepath = 'none';
    }
    // render image page with needed data
    response.render("imagePage.ejs", {image:imagepath, tagField: data});
});


/* activate the server */
// listen on some port
// FOR TESTING ONLY!!! should be 'const PORT = process.env.PORT || 8080;'
const PORT = 8080 || process.env.PORT;
app.listen(PORT);

// tell console status and port #
console.log("Server is running and listen to port " + PORT);
