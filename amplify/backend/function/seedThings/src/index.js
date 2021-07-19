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

// Script used to seed account with IoT things or delete seeded things based on value supplied for mode
// where mode=modes.delete or mode=modes.seed
// Seeded things use naming prefix from value of "demoThingPrefix". This prefix should be selected to not interfere with things in account
// Seedconfig allows user to select number of things to add to account

const AWS = require("aws-sdk");
const iot = new AWS.Iot({ apiVersion: '2015-05-28' });

const modes = { // Script modes, do not change
    delete: 'delete',
    seed: 'seed'
}

let demoThingPrefix = process.env.DEMO_THING_PREFIX; // APPLICATION SPECIFIC: Unique identifier for demo things that will not interfere with things in account

const seedConfig = {
    number: Number(process.env.SEED_NUMBER_OF_THINGS), // APPLICATION SPECIFIC: Number of things to seed account with, no effect for delete
    createThingPerS: Number(process.env.CREATE_THINGS_LIMIT_TPS) // APPLICATION SPECIFIC: Default account limit for create thing/s;
}
const deleteConfig = {
    deleteThingPerS: Number(process.env.DELETE_THINGS_LIMIT_TPS) // APPLICATION SPECIFIC: Default account limit for delete thing/s;
}

/**
 * Returns promise for async/await to wait x ms
 * @param {*} ms time in milliseconds
 * @returns promise with delay based on ms
 */
const wait = async (ms) => {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Creates seedConfig.number of IoT things in account with name starting 
 * with demoThingPrefix 
 */
const seedAccountWithThings = async () => {
    const promiseArray = [];
    for (let i = 0; i < seedConfig.number; i++) {
        const thing = iot.createThing({ thingName: demoThingPrefix + i }).promise();
        promiseArray.push(thing);
        if (i % seedConfig.createThingPerS === 0) {
            console.log('Things Created: ' + i);
            await Promise.all(promiseArray);
            await wait(1000);
        }
    }
    console.log(promiseArray.length);
}

/**
 * Deletes all things in account with name starting with demoThingPrefix
 */
const deleteDemoThings = async () => {
    let thingsAvailable = true;
    let list = {};
    let deleteCount = 1;
    while (thingsAvailable) {
        const listParams = {
            queryString: `${demoThingPrefix}*`,
            maxResults: deleteConfig.deleteThingPerS
        }
        if (list.nextToken) {
            listParams.nextToken = list.nextToken;
        }
        list = await iot.searchIndex(listParams).promise();
        const promiseArray = [wait(1000)];
        for (let i = 0; i < list.things.length; i++) {
            promiseArray.push(iot.deleteThing({ thingName: list.things[i].thingName }).promise());
        }
        await Promise.all(promiseArray);
        console.log(`Things Deleted: ${deleteCount * deleteConfig.deleteThingPerS}`);
        deleteCount++;
        if (!list.nextToken) {
            thingsAvailable = false;
        }
    }
}
/**
 * Creates or deletes things in account with prefix demoThingPrefix
 * @param {*} event Lambda inputs
 */
exports.handler = async (event) => {
    try {
        demoThingPrefix = event.demoThingPrefix ? event.demoThingPrefix : demoThingPrefix;
        seedConfig.number = event.seedConfigNumber ? event.seedConfigNumber : seedConfig.number;

        if (event.mode === modes.delete) {
            await deleteDemoThings();
        } else if (event.mode === modes.seed) {
            await seedAccountWithThings();
        }
    } catch (e) {
        console.log(e);
    }
};
