# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
from botocore.exceptions import ClientError
from helper import AwsHelper
import  datetime

class DocumentStore:

    def __init__(self, documentsTableName, outputTableName, jobTableName = None, embeddingTableName = None):
        self._documentsTableName = documentsTableName
        self._outputTableName = outputTableName
        self._jobTableName = jobTableName
        self._embedTableName = embeddingTableName

    def createSummaryJob(self, documentId, jobStatus, jobId):

        err = None

        dynamodb = AwsHelper().getResource("dynamodb")
        table = dynamodb.Table(self._jobTableName)

        try:
            table.update_item(
                Key = { "documentId": documentId, "jobId": jobId },
                UpdateExpression = 'SET jobStatus = :jobstatusValue',
                ConditionExpression = 'attribute_not_exists(jobId)',
                ExpressionAttributeValues = {
                    ':jobstatusValue': jobStatus
                }
            )
        except ClientError as e:
            print(e)
            if e.response['Error']['Code'] == "ConditionalCheckFailedException":
                print(e.response['Error']['Message'])
                err  = {'Error' : 'Document job already exist.'}
            else:
                raise

        return err

    def createEmbeddingJob(self, documentId, jobStatus, jobId):

        err = None

        dynamodb = AwsHelper().getResource("dynamodb")
        table = dynamodb.Table(self._embedTableName)

        try:
            table.update_item(
                Key = { "documentId": documentId, "jobId": jobId },
                UpdateExpression = 'SET jobStatus = :jobstatusValue',
                ConditionExpression = 'attribute_not_exists(jobId)',
                ExpressionAttributeValues = {
                    ':jobstatusValue': jobStatus
                }
            )
        except ClientError as e:
            print(e)
            if e.response['Error']['Code'] == "ConditionalCheckFailedException":
                print(e.response['Error']['Message'])
                err  = {'Error' : 'Document job already exist.'}
            else:
                raise

        return err

    def createDocument(self, documentId, bucketName, objectName, jobStatus, jobId):

        err = None

        dynamodb = AwsHelper().getResource("dynamodb")
        table = dynamodb.Table(self._documentsTableName)

        try:
            table.update_item(
                Key = { "documentId": documentId },
                UpdateExpression = 'SET bucketName = :bucketNameValue, objectName = :objectNameValue, jobStatus = :jobstatusValue, jobId = :jobIdValue',
                ConditionExpression = 'attribute_not_exists(documentId)',
                ExpressionAttributeValues = {
                    ':bucketNameValue': bucketName,
                    ':objectNameValue': objectName,
                    ':jobstatusValue': jobStatus,
                    ':jobIdValue': jobId
                }
            )
        except ClientError as e:
            print(e)
            if e.response['Error']['Code'] == "ConditionalCheckFailedException":
                print(e.response['Error']['Message'])
                err  = {'Error' : 'Document already exist.'}
            else:
                raise

        return err

    def updateDocumentStatus(self, documentId, documentStatus):

        err = None

        dynamodb = AwsHelper().getResource("dynamodb")
        table = dynamodb.Table(self._documentsTableName)

        try:
            table.update_item(
                Key = { 'documentId': documentId },
                UpdateExpression = 'SET jobStatus = :jobstatusValue',
                ConditionExpression = 'attribute_exists(documentId)',
                ExpressionAttributeValues = {
                    ':jobstatusValue': documentStatus
                }
            )
        except ClientError as e:
            if e.response['Error']['Code'] == "ConditionalCheckFailedException":
                print(e.response['Error']['Message'])
                err  = {'Error' : 'Document does not exist.'}
            else:
                raise

        return err

    def getDocument(self, documentId):

        dynamodb = AwsHelper().getClient("dynamodb")

        ddbGetItemResponse = dynamodb.get_item(
            Key={'documentId': {'S': documentId} },
            TableName=self._documentsTableName
        )

        itemToReturn = None

        if('Item' in ddbGetItemResponse):
            itemToReturn = { 'documentId' : ddbGetItemResponse['Item']['documentId']['S'],
                             'bucketName' : ddbGetItemResponse['Item']['bucketName']['S'],
                             'objectName' : ddbGetItemResponse['Item']['objectName']['S'],
                             'jobId' : ddbGetItemResponse['Item']['jobId']['S'],
                             'jobStatus' : ddbGetItemResponse['Item']['jobStatus']['S'] }

        return itemToReturn

    def deleteDocument(self, documentId):

        dynamodb = AwsHelper().getResource("dynamodb")
        table = dynamodb.Table(self._documentsTableName)

        table.delete_item(
            Key={
                'documentId': documentId
            }
        )

    def getDocuments(self, nextToken=None):

        dynamodb = AwsHelper().getResource("dynamodb")
        table = dynamodb.Table(self._documentsTableName)

        pageSize = 25

        if(nextToken):
            response = table.scan(ExclusiveStartKey={ "documentId" : nextToken}, Limit=pageSize)
        else:
            response = table.scan(Limit=pageSize)

        print("response: {}".format(response))

        data = []

        if('Items' in response):        
            data = response['Items']

        documents = { 
            "documents" : data
        }

        if 'LastEvaluatedKey' in response:
            nextToken = response['LastEvaluatedKey']['documentId']
            print("nexToken: {}".format(nextToken))
            documents["nextToken"] = nextToken

        return documents
