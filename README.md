# IoT Jobs for Rapid Large Scale Device Updates

## Description
This repo includes AWS Lambda functions to achieve AWS IoT Jobs for Rapid Large Scale Device Updates with Advanced Device Group Target Patterns. AWS IoT Jobs is a service used to push updates to targeted edge devices. Each IoT job targets devices in static or dynamic IoT thing groups. This repo provides AWS Lambda functions that follow design patterns to help customers achieve updates at the fastest possible rate of devices per minute, which is required for large scale rapid deployments. The AWS Lambda functions in this repo also address how to target devices when they cannot be modeled using a single thing group (e.g., cannot be described using a simple query). For example, a query with a custom list of things that match the query but must be excluded from the job.

### Seed Things AWS Lambda Function
This function is used for demo/dev purposes to create "n" number of things in an account with a user selected unique prefix. The same function can be used to delete all things with the prefix. This function self-throttles to maintain AWS API calls under service limits. This AWS Lambda function can be used to setup things to test the jobs at scale AWS Lambda function for your application.

#### Seed Things Function Inputs 
* mode (required)
    Description: Use to select if the AWS Lamdba function is being used to add things to account or delete things.  
    Type: Enum ("seed" or "delete")
* demoThingPrefix (optional)
    Description: Prefix for all things added/deleted in account. For example, a prefix of "demo" creates things named "demo1", "demo2", etc.  
    Type: String  
    Default: "delete123Me"  
* seedConfigNumber (optional)
    Description: Number of things to create in account. This input is only used when input "mode"="seed".  
    Type: Number  
    Default: 2000  

#### Seed Things Function Sample Input Events
Seed account with 1,000 things with prefix "myDemoThings"
```
{
    "mode": "seed",
    "demoThingPrefix": "myDemoThings",
    "seedConfigNumber": 1000
}
```

Delete all things with prefix "myDemoThings"
```
{
    "mode": "delete",
    "demoThingPrefix": "myDemoThings"
}
```

### Jobs AWS Lambda Function
This AWS lambda function allows users to quickly start an AWS IoT job at the maximum device update rate to match the account service limit for rapid updates at scale. The function performs the following steps:

1. Enables AWS IoT registry and shadow indexing if not already enabled - this feature has associated cost. The time to enable fleet indexing is dependent on the number of things in your account. If the process takes greater than 15 min for this step to complete, the function will timeout to avoid unnecesary compute. If the function times out, invoke the function again after fleet index is configured. You can manually check the fleet index status by navigating to the AWS IoT settings tab.
2. Creates a dynamic thing group that queries the value of function input "fleetIndexQuery" OR a key/value pair in the thing shadow for key="updateKey".
3. Creates continuous IoT job that targets thing group
4. Performs fleet index query to determine thing target list
5. Updates the shadow of all things in the target list to include the key/value pair from 2. This step rapidly adds the thing to the dynamic thing group. Without a shadow update, the dynamic group would target things based on the fleet index query, which can take requires additional time depending on number of things in account.

If an exclude list was uploaded to the iotJobsLists bucket created by this repo and the file name is provided as an input to the lambda function, the lambda performs the following steps:

1. Enables AWS IoT registry and shadow indexing if not already enabled - this feature has associated cost. The time to enable fleet indexing is dependent on the number of things in your account. If the process takes greater than 15 min for this step to complete, the function will timeout to avoid unnecesary compute. If the function times out, invoke the function again after fleet index is configured. You can manually check the fleet index status by navigating to the AWS IoT settings tab.
2. Creates an empty static thing group named ${jobName}-exclude
3. Downloads Amazon S3 exclude list object data
4. Invokes fillStaticThingGroup AWS Lambda function that recursively adds things from the exclude list to the static group in step 2
5. Creates a dynamic thing group that queries the value of function input "fleetIndexQuery" OR a key/value pair in the thing shadow for key="updateKey" but also excludes things in the static thing group from 2. For example, query string = "(shadow.reported.updateKey:1624489845511 OR delete*) AND NOT thingGroupNames:otaDemoJob-exclude"
6. Creates continuous IoT job that targets thing group
7. Performs fleet index query with query string from 5 to determine thing target list
8. Updates the shadow of all things in the target list to include the key/value pair from 2. This step rapidly adds the thing to the dynamic thing group. Without a shadow update, the dynamic group would target things based on the fleet index query, which can take requires additional time depending on number of things in account.


#### Jobs Function Inputs 
* jobName (optional)
    Description: Unique name for job and dynamic thing group that will be created by function.
    Type: String
    Default: "otaDemoJob"
* fleetIndexQuery (optional)
    Description: Fleet index query used to identify IoT things the job will target. See [samples](https://docs.aws.amazon.com/iot/latest/developerguide/example-queries.html)
    Type: String
    Default: "*"
* excludeListFileName (optional)
    Description: Name of file in iotJobsLists Amazon S3 bucket created by this repo. For example, excludeList.csv. The file must be a csv list of things seperated by carriage returns. For example, filename: "excludeList.csv", filedata: "myDemoThings1\r\nmyDemoThings2\r\nmyDemoThings3" 
    Type: String

#### Jobs Function Sample Input Events
Create a job named "myFirstJob" that targets all things with prefix "myDemoThings" 
```
{
    "jobName": "myFirstJob",
    "fleetIndexQuery": "myDemoThings*"
}
```

Create a job named "mySecondJob" that targets all things with prefix "myDemoThings" but excludes a list that has been uploaded to the iotJobsLists Amazon S3 bucket created by this repo.
```
{
    "jobName": "mySecondJob",
    "fleetIndexQuery": "myDemoThings*",
    "excludeListFileName": "excludeList.csv"
}
```

### Fill Static Thing Group AWS Lambda Function
This function is invoked by the jobs function and is not intended to be manually invoked. The function adds things from an Amazon S3 csv file to an IoT thing group. The function is recursive such that if it is still running after 10 min, the function invokes itself and stops. When invoking itself, the function provides the index of the last IoT thing added to the group and continues adding from this position. The function will continue self invoking until the group is fully populated. 

## Prerequisites
* [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)

* [Nodejs](https://nodejs.org/en/download/)

* [Amplify](https://docs.amplify.aws/cli/start/install) 
```
npm install -g @aws-amplify/cli
amplify configure
```

## Project setup
Clone this repo and then setup amplify project in your AWS account and deploy Amplify resources.
```
amplify init
```
Push backend resources to your AWS account
```
amplify push -y
```

## Walkthrough
Demo Code Walkthrough 

This walkthrough demonstrates how to create an AWS IoT job that queues AWS IoT things at scale. The target group includes things that are selected based on a fleet index query but removes a custom list of things that are provided as an exclude list. This pattern is used to demonstrate how to address scenarios when things cannot be modeled with a simple query. 

Steps:

1. Clone this repo and complete the project setup steps to use AWS Amplify to deploy the AWS infrastructure including AWS Lambda functions and Amazon S3 bucket.
1. Navigate to AWS Lambda and select the seedThings Lambda function. Invoke the seedThings Lambda function with the event below to create 1,000 AWS IoT things with prefix myDemoThings
```
{
    "mode": "seed",   
    "demoThingPrefix": "myDemoThings",    
    "seedConfigNumber": 1000
}
```
1. Upload the sample csv file with a list of things to exclude from the AWS IoT job to the iotJobsLists S3 bucket created by the AWS Amplify deployment (sampleList/excludeMyDemoThings.csv).  
1. Navigate to AWS Lambda and select the job AWS Lambda function. Invoke the job function with event below to create the AWS IoT job, a static group with things from the exclude list, a dynamic group that includes all things selected with the fleetIndexQuery minus the exclude list. Note: This function first enables AWS IoT registry and shadow indexing. The time to enable fleet indexing is dependent on the number of things in your account. If enabling fleet index takes greater than 10 min, the function will timeout to avoid unnecessary compute. If the function times out, invoke the function again after fleet index is enabled. You can manually check the fleet index status by navigating to the AWS IoT settings tab.
```
{    
    "jobName": "myFirstJob",    
    "fleetIndexQuery": "myDemoThings*",    
    "excludeListFileName": "excludeMyDemoThings.csv"
}
```
You can check the status of your job in the AWS IoT console by selecting "Jobs" from the "Manage" dropdown and then selecting "myFirstJob". In the job executions you should see the things that are targeted by the query for your dynamic thing group, while excluding the csv list that you uploaded to S3.  


## Tear down
1. Delete any csv lists uploaded to Amazon S3 iotJobsLists bucket (e.g., excludeMyDemoThings.csv).
2. Delete cloud infrastructure created by AWS Amplify by navigating to the AWS Amplify console and deleting the AWS Amplify App named “iotjobsblog”
3. Invoke seedThings AWS Lambda function with the event below to delete all things with the “myDemoThings” prefix that were created for this walkthrough
```
{
    "mode": "delete",   
    "demoThingPrefix": "myDemoThings"
}
```
4. In IoT jobs, cancel and then delete the IoT jobs you created with the job AWS Lambda function. For example, jobName= "myFirstJob"
5. In IoT Manage Thing Groups, delete the IoT Thing groups “{jobName}” and “{jobName}-exclude” for each job you created with the job AWS Lambda function
6. In IoT Settings, navigate to the Fleet indexing section and select “Manage Indexing”. Update your IoT fleet index configuration back to the original state before completing the walkthrough.
