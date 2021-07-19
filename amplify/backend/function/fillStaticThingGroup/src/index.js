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


// TODO Add comments
// TODO Add error handling
// TODO move constants to environment variables
const AWS = require("aws-sdk");
const iot = new AWS.Iot({ apiVersion: '2015-05-28' });
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();

const jobsListsBucket = process.env.JOBS_LIST_BUCKET_NAME;
const maxAddThingToThingGroup = Number(process.env.ADD_THING_TO_THING_GROUP_TPS); // APPLICATION SPECIFIC: Default service limit for addThingToThingGroup
const lambdaRecursionTimeMs = Number(process.env.LAMBDA_RECURSION_TIME_MS); // Lambda timeout in ms to save state and call self for next iteration
const listDelimiter = process.env.LIST_DELIMITER; // Delimiter for exclude list stored in S3

/**
 * Returns promise for async/await to wait x ms
 * @param {*} ms time in milliseconds
 * @returns promise with delay based on ms
 */
const wait = async (ms) => {
    return new Promise(r => setTimeout(r, ms));
};

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
    return s3Object.Body.toString().split(listDelimiter);
};

/**
 * Creates parameters for lambda.invoke API call
 * @param {*} payload payload for lambda invocation
 * @returns params to call lambda.invoke API 
 */
const getLambdaParams = (payload) => ({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify(payload)
});

/**
 * Adds things from array to IoT static thing group. Recursively calls
 * self when lambda has run > 10 min providing index as starting point for next iteration
 * @param {*} staticGroupName name of IoT static thing group to populate
 * @param {*} thingArray array of IoT thing names
 * @param {*} startTime approximate time that this function was invoked
 * @param {*} startIndex index in thingArray to start at for filling thing group
 * @param {*} excludeListFileName s3 object name for IoT list separated by \r\n 
 * @returns 
 */
const fillStaticGroup = async (staticGroupName, thingArray, startTime, startIndex, excludeListFileName) => {
    console.log('Start Adding Things to Group: ' + staticGroupName);
    let promiseArray = [wait(1000)];
    startIndex = startIndex ? startIndex : 0;

    for (let i = startIndex; i < thingArray.length; i++) {
        if (!thingArray[i]) {
            continue;
        }

        promiseArray.push(iot.addThingToThingGroup({
            thingName: thingArray[i],
            thingGroupName: staticGroupName
        }).promise());
        if (i % maxAddThingToThingGroup === (maxAddThingToThingGroup - 1)) {
            console.log(`Things Added to Group: ${i + 1}`);
            await Promise.all(promiseArray);
            if ((new Date()).getTime() - startTime > lambdaRecursionTimeMs) {
                await lambda.invoke(getLambdaParams({
                    staticGroupName,
                    excludeListFileName,
                    startIndex: i + 1
                })).promise();
                console.log("Self invoke lamdba for next iteration");
                return;
            }
            promiseArray = [wait(1000)];
        }
    }

    await Promise.all(promiseArray);
    console.log(`Completed Adding ${thingArray.length} Things to Group: ${staticGroupName}`);
};

/**
 * Main lambda handler populate thing group with things from S3 list
 * @param {*} event input event to lambda
 */
exports.handler = async (event) => {
    try {
        console.log(event);
        const startTime = (new Date()).getTime();
        const thingArray = await getThingArray(event.excludeListFileName);
        await fillStaticGroup(event.staticGroupName, thingArray, startTime, event.startIndex, event.excludeListFileName);
    } catch (e) {
        console.log(e);
    }
};
