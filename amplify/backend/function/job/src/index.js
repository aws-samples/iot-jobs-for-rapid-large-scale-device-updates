/* Amplify Params - DO NOT EDIT
    ENV
    FUNCTION_FILLSTATICTHINGGROUP_NAME
    REGION
Amplify Params - DO NOT EDIT */

// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files (the "Software"), to deal in the Software
// without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
// PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// This script allow user to nearly instantly start an IoT job at the maximum device update rate at the service limit - updates at scale
// Script creates an IoT job with name "jobName" that targets all things that match "fleetIndexQuery"
// Optional: Use the iot/seedThings/seedThings.js script to create "n" number of things for testing this script
// seedThings.js includes optional cleanup to delete all things that it creates

// Steps for this script
// 1) Enables IoT registry and shadow indexing - this feature has associated cost
// 2) Creates a dynamic thing group that queries "fleetIndexQuery" OR a key/value pair in the thing shadow (defined by "shadow")
// 3) Create IoT job that targets thing group
// 4) Perform fleet index query to determine all things to target - target list
// 5) Update the shadow of all things in the target list to include the key/value pair from 2. 
// Step 5 nearly instantaneously adds the thing to the dynamic thing group. Without a shadow update, the dynamic group would target
// things based on the fleet index query but this process can take hours or days depending on number of things in account

// Clean up: delete IoT job "jobName", delete dynamic thing group "jobName", return fleet index to previous state 

const AWS = require("aws-sdk");
const iot = new AWS.Iot({ apiVersion: '2015-05-28' });
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();

// Global variables;
let iotData;
let jobName;
let fleetIndexQuery;
let excludeListFileName;
let excludeThingArray;

const shadow = {
    key: process.env.SHADOW_UPDATE_KEY, // APPLICATION SPECIFIC: Unique IoT thing shadow update key used for jobs that will not interfere with normal shadow use
    value: (new Date()).getTime() // Unique value for each update performed
};
const maximumPerMinuteJobs = Number(process.env.MAXIMUM_PER_MINUTE_JOBS); // APPLICATION SPECIFIC: Default service limit for jobs/minute
const maxIoTSearchListSize = Number(process.env.MAXIMUM_IOT_SEARCH_LIST_SIZE); // SDK Limit
const maxIoTSearchIterations = Number(process.env.MAXIMUM_IOT_SEARCH_ITERATIONS); // Number of search iterations to update thing shadows for populating job target before recursive lambda call
const pollTimeMs = Number(process.env.POLL_FLEET_INDEX_STATUS_MS); // Time in ms to poll fleet index creation is complete. Only occurs if fleet indexing is not enabled
const defaultJobName = process.env.DEFAULT_JOB_NAME; // Default job name used when not provided as lambda input
const defaultFleetIndexQuery = process.env.DEFAULT_FLEET_INDEX_QUERY; // Default fleet index query used when not provided as lambda input
const listDelimiter = process.env.LIST_DELIMITER; // Delimiter for exclude list stored in S3

const jobsListsBucket = process.env.JOBS_LIST_BUCKET_NAME;

/**
 * Returns promise for async/await to wait x ms
 * @param {*} ms time in milliseconds
 * @returns promise with delay based on ms
 */
const wait = async (ms) => {
    return new Promise(r => setTimeout(r, ms));
};

/**
 * Polls IoT fleet index until indexStatus is 'Active'. Used after activating fleet indexing
 * and before taking furthur steps that require fleet indexing
 */
const waitForIndexBuild = async () => {
    let indexBuilding = true;
    let i = 1;
    while (indexBuilding) {
        const indexName = "AWS_Things";
        const index = await iot.describeIndex({ indexName }).promise();
        console.log(`Index ${indexName} status: ${index.indexStatus}. ${i * pollTimeMs / 1000} seconds elapsed`);
        if (index.indexStatus === 'ACTIVE') {
            indexBuilding = false;
        } else {
            await wait(pollTimeMs);
        }
        i++;
    }
};

/**
 * Creates params for API call to updateIndexConfiguration to activate IoT fleet indexing
 * for registry and shadow
 */
const updateIndexRegistryShadowParams = {
    thingIndexingConfiguration: {
        thingIndexingMode: 'REGISTRY_AND_SHADOW'
    }
};

/**
 * Enables IoT fleet index and waits for fleet index to be activate before completing
 */
const enableFleetIndexing = async () => {
    const indexConfig = await iot.getIndexingConfiguration().promise();
    if (
        indexConfig.thingIndexingConfiguration.thingIndexingMode !== 'REGISTRY_AND_SHADOW'
    ) {
        console.log('Activating Fleet Indexing...');
        await iot.updateIndexingConfiguration(updateIndexRegistryShadowParams).promise();
        await waitForIndexBuild();
        console.log('Fleet Indexing Active');
    } else {
        console.log('Fleet Indexing is already enabled in account');
    }
};

/**
 * Creates a static thing group that is used to exclude things from an IoT job
 * @returns IoT thing group name for job exclude list
 */
const createStaticGroup = async () => {
    console.log('Static Group Creation Starting...');
    const group = await iot.createThingGroup({ thingGroupName: `${jobName}-exclude` }).promise();
    console.log('Static Group Creation Complete');
    return group.thingGroupName;
};

/**
 * Creates parameters for lambda.invoke API call to fill IoT thing group with 
 * things in S3 list provided as part of payload
 * @param {*} payload payload for lambda invocation
 * @returns params to call lambda.invoke API 
 */
const getLambdaFillStaticThingGroupParams = (payload) => ({
    FunctionName: process.env.FUNCTION_FILLSTATICTHINGGROUP_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify(payload)
});

/**
 * Gets S3 IoT thing list and returns as array of things 
 * @param {*} fileName s3 object name for IoT list separated by \r\n 
 * @returns array of thing names
 */
const getThingArray = async (fileName) => {
    const s3Object = await s3.getObject({
        Bucket: jobsListsBucket,
        Key: fileName
    }).promise();
    excludeThingArray = s3Object.Body.toString().split(listDelimiter);
};

/**
 * Creates a static thing group and async invokes lambda to fill group with things
 * Also populates exclude list in excludeThingArray global variable
 * @returns void
 */
const excludeList = async () => {
    if (!excludeListFileName) {
        return;
    }
    const staticGroupName = await createStaticGroup();
    const invokeParams = getLambdaFillStaticThingGroupParams({
        excludeListFileName,
        staticGroupName,
    });
    await lambda.invoke(invokeParams).promise();
    await getThingArray(excludeListFileName);
};

/**
 * Creates dynamic thing goup
 * @returns dynamic thing group arn
 */
const createDynamicGroup = async () => {
    console.log('Dynamic Group Creation Starting...');

    let queryString = `shadow.reported.${shadow.key}:${shadow.value} OR ${fleetIndexQuery}`;
    if (excludeListFileName) {
        queryString = `(${queryString}) AND NOT thingGroupNames:${jobName}-exclude`;
    }

    const group = await iot.createDynamicThingGroup({
        queryString,
        thingGroupName: jobName
    }).promise();
    console.log('Dynamic Group Creation Complete');
    return group.thingGroupArn;
};

/**
 * Creates continuous IoT job targeting input thing group
 * @param {*} thingGroupArn thing group arn
 */
const createJob = async (thingGroupArn) => {
    console.log('Job Creation Starting...');
    await iot.createJob({
        jobId: jobName,
        targets: [thingGroupArn],
        document: JSON.stringify({
            job: jobName
        }),
        jobExecutionsRolloutConfig: {
            maximumPerMinute: String(maximumPerMinuteJobs)
        },
        targetSelection: "CONTINUOUS"
    }).promise();
    console.log('Job Creation Complete...');
};

/**
 * API params to update thing shadow of specific reported key/value pair for this IoT job
 * @param {*} thingName Thing to update shadow
 * @returns params for API call to update thing shadow
 */
const getUpdateShadowParams = (thingName) => ({
    thingName,
    payload: JSON.stringify({
        state: {
            reported: {
                [shadow.key]: shadow.value
            }
        }
    }),
});

/**
 * API params to recursively call this lambda function to continue 
 * updating thing shadows
 * @param {*} nextToken stateful token from last iteration
 * @returns params for API call to invoke lambda
 */
const getLambdaInvokeParams = (nextToken) => ({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify({
        shadowKey: shadow.key,
        shadowValue: shadow.value,
        nextToken: nextToken,
        jobName,
        fleetIndexQuery,
        excludeListFileName
    })
});

/**
 * Creates iot data client if not available in global variable (occurs
 * on lambda cold starts)
 */
const getIoTDataClient = async () => {
    if (!iotData) {
        const endpoint = await iot.describeEndpoint({ endpointType: "iot:Data-ATS" }).promise();
        iotData = new AWS.IotData({
            endpoint: endpoint.endpointAddress,
            apiVersion: '2015-05-28'
        });
    }
};

/**
 * Get API params for IoT fleet index search  
 * @param {*} list results from previous iteration of index search including
 * next token
 * @returns search index results
 */
const getSearchIndexParams = (list) => {
    const listParams = {
        queryString: fleetIndexQuery,
        maxResults: maxIoTSearchListSize
    };
    if (excludeListFileName) {
        listParams.queryString = `(${listParams.queryString}) AND NOT thingGroupNames:${jobName}-exclude`;
    }
    if (list.nextToken) {
        listParams.nextToken = list.nextToken;
    }
    return listParams;
};

/**
 * Updates all thing shadows for things in provided thing array
 * @param {*} list results from previous iteration of index search including
 * next token
 * @param {*} updateCount update thing shadow counter
 * @returns update thing shadow counter
 */
const updateShadowsFromThingArray = async (list, updateCount) => {
    const promiseArray = [wait(1000)];
    for (let i = 0; i < list.things.length; i++) {
        const thingName = list.things[i].thingName;
        if (excludeListFileName && excludeThingArray.includes(thingName)) {
            continue;
        }
        promiseArray.push(iotData.updateThingShadow(getUpdateShadowParams(thingName)).promise());
    }
    await Promise.all(promiseArray);
    console.log(`Shadows Updated: ${updateCount * maxIoTSearchListSize}`);
    return updateCount++;
};

/**
 * Iterates through updating thing shadows from fleet index query
 * Recursively invokes this lambda after 200 iterations
 * @param {*} nextToken fleet index search nextToken from previous iteration
 */
const updateShadows = async (nextToken) => {
    await getIoTDataClient();

    let thingsAvailable = true;
    let list = { nextToken };
    let updateCount = 1;
    console.log(`Update Thing Shadows Starting... to contain, ${shadow.key}:${shadow.value}`);
    while (thingsAvailable) {
        list = await iot.searchIndex(getSearchIndexParams(list)).promise();
        updateCount = await updateShadowsFromThingArray(list, updateCount);
        if (!list.nextToken) {
            thingsAvailable = false;
        } else if (updateCount > maxIoTSearchIterations) {
            thingsAvailable = false;
            const lambdaInvokeParams = getLambdaInvokeParams(list.nextToken);
            await lambda.invoke(lambdaInvokeParams).promise();
        }
    }
    console.log('Update Thing Shadows Complete');
    console.log('Job is targeting all devices from query');
};

/**
 * Initializes global variables if not contained in lambda invocation event
 * @param {*} inputs event from lambda invocation
 */
const initGlobals = (inputs) => {
    jobName = inputs.jobName ? inputs.jobName : defaultJobName;
    fleetIndexQuery = inputs.fleetIndexQuery ? inputs.fleetIndexQuery : defaultFleetIndexQuery;
    excludeListFileName = inputs.excludeListFileName ? inputs.excludeListFileName : null;
    excludeThingArray = null;
};

/**
 * Main handler. 
 * On first iteration, enables fleet indexing,
 * Creates dynamic thing group that excludes things from exclude list and 
 * then creates IoT job. 
 * 
 * Updates thing shadows from fleet index query to populate dynamic thing group
 * Recursively invokes this lambda while populating to avoid timeout. Iterations 
 * after first iteration continue to update thing shadows.
 * @param {*} event 
 */
exports.handler = async (event) => {
    try {
        initGlobals(event);
        if (!event.nextToken) {
            await enableFleetIndexing();
            await excludeList(event.nextToken);
            const thingGroupArn = await createDynamicGroup();
            await createJob(thingGroupArn);
        } else {
            shadow.key = event.shadowKey;
            shadow.value = event.shadowValue;
            await getThingArray(excludeListFileName);
        }
        await updateShadows(event.nextToken);
    } catch (e) {
        console.log(e);
    }
};
