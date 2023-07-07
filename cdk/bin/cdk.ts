// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkStack } from '../lib/cdk-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
const stack = new CdkStack(app, 'CdkStack', { env: {region: 'us-east-1'} });
NagSuppressions.addStackSuppressions(stack, [
    { id: 'AwsSolutions-COG4', reason: 'All API Gateway methods are protected by IAM authentication' },
    { id: 'AwsSolutions-CFR4', reason: 'I will document that a production deployment should use a non-default certificate' },
    { id: 'AwsSolutions-IAM4', reason: 'Lambda default role only grants normal access to create Cloudwatch log groups' },
    { id: 'AwsSolutions-IAM5', reason: 'Lambda default role access to S3 is properly scoped' },
    { id: 'AwsSolutions-APIG2', reason: 'Request validation is handled by the Lambda functions' },
    { id: 'AwsSolutions-APIG4', reason: 'All API Gateway methods are protected by IAM authentication' },
  ]);
