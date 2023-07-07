# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os
import traceback
import json
from helper import AwsHelper
import datastore

def postMessage(client, qUrl, jsonMessage):

    message = json.dumps(jsonMessage)

    client.send_message(
        QueueUrl=qUrl,
        MessageBody=message
    )

    print("Submitted message to queue: {}".format(message))

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

# Inputs: document id and s3 location of output
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
        chunkSize = payload['chunkSize']
        chunkOverlap = payload['chunkOverlap']
        max_length = payload['max_length']
        top_p = payload['top_p']
        top_k = payload['top_k']
        num_beams = payload['num_beams']
        temperature = payload['temperature']

        queueUrl = os.environ['QUEUE_URL']
        jobTable = os.environ['JOB_TABLE']

        jsonMessage = { 'documentId' : docId,
            'bucketName': bucket,
            'objectName' : name,
            'jobId': docId,
            'chunkSize': chunkSize,
            'chunkOverlap': chunkOverlap,
            'max_length': max_length,
            'top_p': top_p,
            'top_k': top_k,
            'num_beams': num_beams,
            'temperature': temperature}

        try:
            client = AwsHelper().getClient('sqs')
            postMessage(client, queueUrl, jsonMessage)
            ds = datastore.DocumentStore("", "", jobTable)
            ds.createSummaryJob(docId, "Started", docId)
            
            return respond(None, {'msg': "Summarization started", 'job': docId})
        except Exception as e:
            trc = traceback.format_exc()
            print(trc)
            return respond(ValueError(f"Could not summarize doc: {str(e)}"));
