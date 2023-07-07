# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import os
import boto3
import traceback

def lambda_handler(event, context):

    print("event: {}".format(event))

    message = json.loads(event['Records'][0]['body'])

    print("Message: {}".format(message))
    docId = message['documentId']
    bucket = message['bucketName']
    name = message['objectName']
    jobId = message['jobId']
    chunk_size = message['chunkSize']
    chunk_overlap = message['chunkOverlap']
    max_length = message['max_length']
    top_p = message['top_p']
    top_k = message['top_k']
    num_beams = message['num_beams']
    temperature = message['temperature']

    clusterArn = os.environ['target']
    taskDefinitionArn = os.environ['taskDefinitionArn']
    subnets = os.environ['subnets']
    subnet_list = subnets.split(',')

    try:
        ecs = boto3.client('ecs')
        response = ecs.run_task(
            cluster=clusterArn, 
            count=1, 
            launchType='FARGATE', 
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': subnet_list
                }
            }, 
            overrides={
                'containerOverrides': [
                    {
                        'name': 'worker',
                        'environment': [
                            {
                                'name': 'docId',
                                'value': docId
                            },
                            {
                                'name': 'jobId',
                                'value': jobId
                            },
                            {
                                'name': 'bucket',
                                'value': bucket
                            },
                            {
                                'name': 'name',
                                'value': name
                            },
                            {
                                'name': 'chunk_size',
                                'value': str(chunk_size)
                            },
                            {
                                'name': 'chunk_overlap',
                                'value': str(chunk_overlap)
                            },
                        ],
                    }
                ]
            },
            taskDefinition=taskDefinitionArn
        )
        output = f"Launched task"
    except Exception as e:
        trc = traceback.format_exc()
        print(trc)
        output = str(e)

    return {
        'statusCode': 200,
        'body': output
    }
