# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import os
from helper import AwsHelper
import traceback
import datastore

def processRequest(documentId, bucketName, objectName, snsRole, snsTopic):

    print("Starting job with documentId: {}, bucketName: {}, objectName: {}".format(documentId, bucketName, objectName))

    response = None
    client = AwsHelper().getClient('textract')
    response = client.start_document_text_detection(
        ClientRequestToken  = documentId,
        DocumentLocation={
            'S3Object': {
                'Bucket': bucketName,
                'Name': objectName
                }
        },
        NotificationChannel= {
            "RoleArn": snsRole,
            "SNSTopicArn": snsTopic
        },
        JobTag = documentId
    )

    return response["JobId"]



def respond(err, res=None):
    return {
        'statusCode': '400' if err else '200',
        'body': str(err) if err else json.dumps(res),
        'headers': {
            'Content-Type': 'application/json',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": 'true'
        },
    }

# Inputs: document id and s3 location
def lambda_handler(event, context):

    print("Received event: " + json.dumps(event, indent=2))
    operation = event['httpMethod']

    if operation != "POST":
        return respond(ValueError('Unsupported method "{}"'.format(operation)))
    else:
        payload = event['queryStringParameters'] if operation == 'GET' else json.loads(event['body'])
        docId = payload['docId']
        bucket = payload['bucket']
        name = payload['name']
        snsTopic = os.environ['SNS_TOPIC_ARN']
        snsRole = os.environ['SNS_ROLE_ARN']
        outputTable = os.environ['OUTPUT_TABLE']
        documentsTable = os.environ['DOCUMENTS_TABLE']

        try:
            jobId = processRequest(docId, bucket, name, snsRole, snsTopic)
            print(f"Started textract job {jobId}")
            ds = datastore.DocumentStore(documentsTable, outputTable)
            ds.createDocument(docId, bucket, name, "Started", jobId)
            return respond(None, {'msg': "Job started", 'jobId': jobId})
        except Exception as e:
            trc = traceback.format_exc()
            print(f"Error starting textract job: {str(e)} - {trc}")
            return respond(ValueError(f"Could not start job: {str(e)}"));
