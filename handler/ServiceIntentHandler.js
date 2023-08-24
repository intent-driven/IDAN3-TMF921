//////////////////////////////////////////////////////////////
/*              Ericsson IRC                                */
/*              Idan Catalyst                               */
/* ServiceIntentHandler:                                    */
/* Service Intent Handler sends a service order over TMF641 */
/* and creates/deletes the Knowledge objects                */
//////////////////////////////////////////////////////////////
'use strict';

const util = require('util');
const uuid = require('uuid');
const fs = require('fs');
const async = require('async');
const $rdf = require('rdflib')
const notificationUtils = require('../utils/notificationUtils');
const {TError, TErrorEnum, sendError} = require('../utils/errorUtils');
const handlerUtils = require('../utils/handlerUtils');
const handlerUtils23 = require('../utils/handlerUtils23');
const Intent = require('../controllers/Intent');
const intentHandler = require('./IntentHandler')

const S3_children = ['IR3_1_Power','IR3_3_Power','IR3_2_Power']

// Initialize parameters to be processed in service intent, the values 
// are modified later based on what is received in actual intent
var serviceIntentParams = {
  "intentName": "XYZintent",
  "bandwidth": 10,
  "availability": 0.9999,
  "networkUtil" : 0.6,
  "quality": "Premium",
  "site": "A wonderful site",
  "reportInterval": 1
};

// This function is called from the SI once the intent has been stored in MongoDB
//it will send a service order to SO over TMF641,
//extract the expression from the request body, parse the expresion into
//triples and then store these triples in the graphdb.
//It then reads a hardcoded intent report and send this back to the listeners 
//using the SI HUB
exports.processIntent = function(req) {

  //extract expression
  const expression = handlerUtils.getExpression(req);
  extractParamsFromIntent(expression, 'text/turtle');
  console.log("Received Intent Params = " + JSON.stringify(serviceIntentParams));

  var serviceOrder;
  var name;
  if (expression.indexOf("S1") > 0) {
    serviceOrder = 'a.json';
    name = 'S1;'
  }
  else if (expression.indexOf("S2") > 0) {
    serviceOrder = 'b.json';
    name = 'S2;'
  }
  else if (expression.indexOf("S3") > 0) {
    serviceOrder = 'service_order_CSP_USAGE_CONDITION_CREATE.json';
    name = 'S3;'
  }
    //From expression extract triples and load the intent in GraphDB 
  handlerUtils.extractTriplesandKG(expression, `insert`, 'text/turtle',name);

  createIntentReport(req,name);
  var id = req.body.id;
  
  sendCreateServiceOrder(id,serviceOrder);

  /* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
//    handlerUtils23.postPythonRI(req.originalUrl,id,req.body);
  handlerUtils23.process_intents(expression,id,req.body.version)

  /* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/
    
};

function sendCreateServiceOrder(id,serviceOrder) {
  const soUtils = require('../utils/soUtils');
  
  fs.readFile(`./serviceorders/${serviceOrder}`, 'utf8', (err, createOrder) => {

    if (err) {
      console.error('unable to read create service order json file due to error:', err);
      return;
    }
 
    var createOrderJson = JSON.parse(createOrder);
    //add the service intent id
    createOrderJson.orderItems[0].service.publicIdentifier = id;

    if ((serviceIntentParams.quality == 'Premium') && (serviceIntentParams.availability >= 0.99)) {
      createOrderJson.orderItems[0].service.characteristics[1].value = "10";
    } else {
      createOrderJson.orderItems[0].service.characteristics[1].value = "5";
    }

    //createOrderJson.orderItems[0].service.characteristics[2].value = serviceIntentParams.site.toString();
    
    console.log("SERVICE ORDER = " + JSON.stringify(createOrderJson));

    try {
      soUtils.sendServiceOrder(JSON.stringify(createOrderJson));
    }
    catch (error) {
      console.error('SIH: sendCreateServiceOrder failed with error:', error);
      return;
    }
  });
}


function createIntentReport(req,name) {
  var filename;
  var children;
  if (name.indexOf("S1") >= 0) {

     // 1. Intent Accepted
     filename = 'S1R1_Intent_Accepted.ttl'
     handlerUtils.sendIntentReport('S1R1_Intent_Accepted', filename, req);
     console.log('log: S1 Report Accepted sent');

     // 2. Intent Degraded
     filename = 'S1R2_Intent_Degraded.ttl'
     handlerUtils.sendIntentReport('S1R2_Intent_Degraded', filename, req);
     console.log('log: S1 Report Degraded sent');
     // 3. The send the S1 intent
     //just needed to test without symphonica
     var filename = 'R1_catalyst_resource_intent_slice.ttl'
     handlerUtils.postIntent('R1_Intent_Slice_Core',filename,req);
     console.log('log: R1-1 Intent POSTed');
  }
  if (name.indexOf("S2") >= 0) {

    // 1. Intent Accepted
    filename = 'S1R1_Intent_Accepted.ttl'
    handlerUtils.sendIntentReport('S1R1_Intent_Accepted', filename, req);
    console.log('log: S1 Report Accepted sent');

    // 2. Intent Degraded
    filename = 'S1R2_Intent_Degraded.ttl'
    handlerUtils.sendIntentReport('S1R2_Intent_Degraded', filename, req);
    console.log('log: S1 Report Degraded sent');
    // 3. The send the S1 intent
    //just needed to test without symphonica
    var filename = 'R1_catalyst_resource_intent_slice.ttl'
    handlerUtils.postIntent('R1_Intent_Slice_Core',filename,req);
    console.log('log: R1-1 Intent POSTed');
  }
  if (name.indexOf("S3") >= 0) {
     // 1. Intent Accepted
     filename = 'S3R1_Intent_Accepted'
     handlerUtils.sendIntentReport(filename, filename+'.ttl', req);
     console.log(`log: ${filename} sent`);

     // 2. Intent Degraded
     filename = 'S3R2_Intent_Compliant'
     handlerUtils.sendIntentReport(filename, filename+'.ttl', req);
     console.log(`log: ${filename} sent`);
     
     // 3. The send the R3 intent
     //just needed to test without symphonica
     children = [...S3_children]
     children.forEach(x => {
       handlerUtils.postIntent(x, x+'.ttl', req);
       console.log(`log: ${x} Intent Posted`);
     }
    )
  }
}

function extractParamsFromIntent(expression, type) {
  const RDF = $rdf.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
  const RDFS = $rdf.Namespace("http://www.w3.org/2000/01/rdf-schema#");
  const EX = $rdf.Namespace("http://www.example.org/IDAN3#");
  const ICM = $rdf.Namespace("http://tio.models.tmforum.org/tio/v3.2.0/IntentCommonModel#");
  const CEM = $rdf.Namespace("http://tio.labs.tmforum.org/tio/v1.0.0/CatalystExtensionModel#");
  const MET = $rdf.Namespace("http://www.sdo2.org/TelecomMetrics/Version_1.0#");
  const T = $rdf.Namespace("http://www.w3.org/2006/time#");

  var uri = 'http://www.example.org/IDAN3#';
  var mimeType = 'application/ld+json';
  if (type !== undefined) {
    mimeType = type;
  }

  var store = $rdf.graph();
  //create rdf object
  try {
    $rdf.parse(expression, store, uri, mimeType);

    var intentName = store.each(undefined, CEM('layer'), "service");
    serviceIntentParams.intentName = intentName[0].value;

    var networkUtilObservationObject = store.each(undefined, ICM('latestValueOf'), MET('NetworkUtilization'));
    var networkUtilTriplesSubject = store.each(undefined, ICM('observation'), networkUtilObservationObject[0]);
    var networkUtilTriples = store.each(networkUtilTriplesSubject[0], ICM('smaller'), undefined);
    var networkUtil = store.each(networkUtilTriples[0], ICM('value'), undefined);
    if ((networkUtilObservationObject[0] == undefined) || (networkUtilTriplesSubject[0] == undefined) || (networkUtilTriples[0] == undefined) || (networkUtil[0] == undefined)) {
      serviceIntentParams.networkUtil = null;
    } else {
      serviceIntentParams.networkUtil = parseFloat(networkUtil[0].value);
    }
    
    var bandwidthObservationObject = store.each(undefined, ICM('latestValueOf'), MET('ServiceBandwidth'));
    var bandwidthTriplesSubject = store.each(undefined, ICM('observation'), bandwidthObservationObject[0]);
    var bandwidthTriples = store.each(bandwidthTriplesSubject[0], ICM('atLeast'), undefined);
    var bandwidth = store.each(bandwidthTriples[0], ICM('value'), undefined);
    if ((bandwidthObservationObject[0] == undefined) || (bandwidthTriplesSubject[0] == undefined) || (bandwidthTriples[0] == undefined) || (bandwidth[0] == undefined)) {
      serviceIntentParams.bandwidth = null;
    } else {
      serviceIntentParams.bandwidth = parseFloat(bandwidth[0].value);
    }

    var availabilityObservationObject = store.each(undefined, ICM('latestValueOf'), MET('ServiceAvailability'));
    var availabilityTriplesSubject = store.each(undefined, ICM('observation'), availabilityObservationObject[0]);
    var availabilityTriples = store.each(availabilityTriplesSubject[0], ICM('atLeast'), undefined);
    var availability = store.each(availabilityTriples[0], ICM('value'), undefined);
    if ((availabilityObservationObject[0] == undefined) || (availabilityTriplesSubject[0] == undefined) || (availabilityTriples[0] == undefined) || (availability[0] == undefined)) {
      serviceIntentParams.availability = null;
    } else {
      serviceIntentParams.availability = parseFloat(availability[0].value);
    }

    var qualityTriples = store.each(EX('S1P5_service_level'), ICM('intersectsWith'), undefined);
    var quality = store.each(qualityTriples[0], RDFS('member'), undefined);
    if ((qualityTriples[0] == undefined) || (quality[0] == undefined)) {
      serviceIntentParams.quality = null;
    } else if (CEM('PremiumService').equals(quality[0])) {
      serviceIntentParams.quality = 'Premium';
    } else {
      serviceIntentParams.quality = '';
    }

    var locationsTriplesSubject = store.each(undefined, ICM('includedIn'), MET('ConnectedLocations'));
    var locationsTriples = store.each(locationsTriplesSubject[0], ICM('subjectContainer'), undefined);
    var locations = store.each(locationsTriples[0], RDF('member'), undefined);
    if ((locationsTriplesSubject[0] == undefined) || (locationsTriples[0] == undefined) || (locations[0] == undefined) || (locations[1] == undefined)) {
      serviceIntentParams.locations = null;
    } else {
      serviceIntentParams.locations = [locations[0].value, locations[1].value];
    }

    var reportIntervalTriplesSubject = store.each(undefined, RDF('type'), ICM('ReportingExpectation'));
    var reportIntervalTriples = store.each(reportIntervalTriplesSubject[0], ICM('reportingInterval'), undefined);
    var reportIntervalValue = store.each(reportIntervalTriples[0], T('numericDuration'), undefined);
    var reportIntervalUnit = store.each(reportIntervalTriples[0], T('temporalUnit'), undefined);
    if ((reportIntervalTriplesSubject[0] == undefined) || (reportIntervalTriples[0] == undefined) || (reportIntervalValue[0] == undefined) || (reportIntervalUnit[0] == undefined)) {
      serviceIntentParams.reportInterval = null;
    } else if (T('unitSecond').equals(reportIntervalUnit[0])) {
      serviceIntentParams.reportInterval = parseFloat(reportIntervalValue[0].value);
    } else if (T('unitMinute').equals(reportIntervalUnit[0])) {
      serviceIntentParams.reportInterval = parseFloat(reportIntervalValue[0].value * 60);
    } else if (T('unitHour').equals(reportIntervalUnit[0])) {
      serviceIntentParams.reportInterval = parseFloat(reportIntervalValue[0].value * 3600);
    } else {
      serviceIntentParams.reportInterval = -1;
    }
  }
  catch (err) {
    console.log(err);
  };
};


// This function is called from the SI once the intent has been deleted from MOngo
//it deletes the service order in SO over TMF641,
//reads the intent expression from mongo, parses the expression into
//triples and then deletes these triples from the graphdb.
exports.deleteIntent = function(query, resourceType,intentname,req) {
  var serviceOrder;
  var name;
  var children
  if (intentname.indexOf("S1") > 0) {
    serviceOrder = 'a.json';
    name = 'S1;'
  }
  else if (intentname.indexOf("S2") > 0) {
    serviceOrder = 'b.json';
    name = 'S2;'
  }
  else if (intentname.indexOf("S3") > 0) {
    serviceOrder = 'service_order_CSP_USAGE_CONDITION_DELETE.json';
    name = 'S3;'
    children = [...S3_children]
}
  
  sendDeleteServiceOrder(serviceOrder,query.id)

  console.log('query.id: ' + query.id)
  console.log('resourceType: ' + resourceType)
  //reads intent from mongo and then deletes objects from KG.  All in one function as async
  handlerUtils.getIntentExpressionandDeleteKG(query, resourceType);
  //delete children intent
  children.forEach(x => {
    intentHandler.deleteIntentbyName(x,req,false);
    console.log(`log: ${x} Delete`);
    }
  )
/* 2023 XXXXXXXXXXXXX Huawei IRC - Start  XXXXXXXXXXXXXXXx*/
    //Call the python server 
//    handlerUtils23.deletePythonRI(req,query.id);
handlerUtils23.delete_intents(intentname)

/* 2023 XXXXXXXXXXXXX Huawei IRC - End  XXXXXXXXXXXXXXXx*/

};

function sendDeleteServiceOrder(serviceOrder,id) {
  const soUtils = require('../utils/soUtils');
  
  fs.readFile(`./serviceorders/${serviceOrder}`, 'utf8', (err,deleteOrder) => {

    if (err) {
      console.error('unable to read delete service order json file due to error:', err);
      return;
    }
 
    var deleteOrderJson = JSON.parse(deleteOrder);
    //add the service intent id
    deleteOrderJson.orderItems[0].service.publicIdentifier = id;
    console.log("SERVICE ORDER = " + JSON.stringify(deleteOrderJson));

    try {
      soUtils.sendServiceOrder(JSON.stringify(deleteOrderJson));
    }
    catch (error) {
      console.error('SIH: deleteIntent failed with error:', error);
      return;
    }
  });
  
}
// This function is called from the SI once the intentReport has been deleted from MOngo
//it reads the intentReport expression from mongo, parse the expresion into
//triples and then deletes these triples from the graphdb.
exports.deleteIntentReports = function(id, resourceType) {

  console.log('intentid: ' + id)
  console.log('resourceType: ' + resourceType)
  //reads intent report from mongo and then deletes objects from KG.  All in one function as async
  handlerUtils.getIntentReportExpressionandDeleteKG(id, resourceType);
};
