// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import iam = require('aws-cdk-lib/aws-iam');
import {ObjectOwnership} from "aws-cdk-lib/aws-s3";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import sns = require('aws-cdk-lib/aws-sns');
import snsSubscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
import sqs = require('aws-cdk-lib/aws-sqs');
import dynamodb = require('aws-cdk-lib/aws-dynamodb');
import lambda = require('aws-cdk-lib/aws-lambda');
import s3 = require('aws-cdk-lib/aws-s3');
import apigw = require('aws-cdk-lib/aws-apigateway');
import ecs = require('aws-cdk-lib/aws-ecs');
import ec2 = require('aws-cdk-lib/aws-ec2');
import cognito = require('aws-cdk-lib/aws-cognito');
import cloudfront = require('aws-cdk-lib/aws-cloudfront');
import origins = require('aws-cdk-lib/aws-cloudfront-origins');
import cognitoIdp = require('@aws-cdk/aws-cognito-identitypool-alpha');
import logs = require('aws-cdk-lib/aws-logs');
import efs = require('aws-cdk-lib/aws-efs');
import elb = require('aws-cdk-lib/aws-elasticloadbalancingv2');
import kms = require('aws-cdk-lib/aws-kms');
import ssm = require('aws-cdk-lib/aws-ssm');
import wafv2 = require ('aws-cdk-lib/aws-wafv2');

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const key = new kms.Key(this, 'KmsKey', {
      enableKeyRotation: true,
    });

    //**********SNS Topics******************************
    const jobCompletionTopic = new sns.Topic(this, 'JobCompletion', {
      masterKey: key
    });

    //**********IAM Roles******************************
    const textractServiceRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com')
    });
    textractServiceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [jobCompletionTopic.topicArn],
        actions: ["sns:Publish"]
      })
    );
    textractServiceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [key.keyArn],
        actions: [
          "kms:GenerateDataKey",
          "kms:Decrypt"
        ]
      })
    );

    //**********S3 Bucket******************************
    const corsRule: s3.CorsRule = {
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.HEAD,
        s3.HttpMethods.PUT,
        s3.HttpMethods.POST,
        s3.HttpMethods.DELETE,
      ],
      allowedOrigins: ['*'],
    
      // the properties below are optional
      allowedHeaders: ['*'],
      exposedHeaders: [
        "x-amz-server-side-encryption",
        "x-amz-request-id",
        "x-amz-id-2",
        "ETag"
      ],
      maxAge: 3000,
    };
    const contentBucket = new s3.Bucket(this, 'DocumentsBucket', { 
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [corsRule],
      serverAccessLogsPrefix: 'accesslogs',
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,

    });
    const appBucket = new s3.Bucket(this, 'AppBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      serverAccessLogsPrefix: 'accesslogs',
      publicReadAccess: false,
      enforceSSL: true,
    });

    //**********DynamoDB Table*************************
    //DynamoDB table with textract output link
    // Fields = document, output type, s3 location
    const outputTable = new dynamodb.Table(this, 'OutputTable', {
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'outputType', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true
    });

    //DynamoDB table with job status info. 
    // Fields = document id, job id, status, s3 location
    const documentsTable = new dynamodb.Table(this, 'JobTable', {
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    // DynamoDB table with summarization job info. 
    // Fields = document id, job id, status, summary text
    const summarizationTable = new dynamodb.Table(this, 'SummarizationTable', {
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    // Table with embedding job info
    // Fields = document id, job id, status
    const embeddingTable = new dynamodb.Table(this, 'EmbeddingTable', {
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    //**********SQS Queues*****************************
    //DLQ
    const dlq = new sqs.Queue(this, 'DLQ', {
      visibilityTimeout: cdk.Duration.seconds(30), retentionPeriod: cdk.Duration.seconds(1209600),
      enforceSSL: true,
    })

    //Queues
    const jobResultsQueue = new sqs.Queue(this, 'JobResults', {
      visibilityTimeout: cdk.Duration.seconds(900), retentionPeriod: cdk.Duration.seconds(1209600), deadLetterQueue: { queue: dlq, maxReceiveCount: 50 },
      enforceSSL: true,
    });
    //Trigger
    jobCompletionTopic.addSubscription(
      new snsSubscriptions.SqsSubscription(jobResultsQueue)
    );
    const summarizationResultsQueue = new sqs.Queue(this, 'SummarizationResults', {
      visibilityTimeout: cdk.Duration.seconds(900), enforceSSL: true,
      retentionPeriod: cdk.Duration.seconds(1209600), deadLetterQueue: { queue: dlq, maxReceiveCount: 50 }
    });
    const embeddingQueue = new sqs.Queue(this, 'EmbeddingQueue', {
      visibilityTimeout: cdk.Duration.seconds(900), enforceSSL: true,
      retentionPeriod: cdk.Duration.seconds(1209600), deadLetterQueue: { queue: dlq, maxReceiveCount: 50 }
    });

    //**********Lambda Functions******************************

    // Helper Layer with helper functions
    const helperLayer = new lambda.LayerVersion(this, 'HelperLayer', {
      code: lambda.Code.fromAsset('lambda/helper'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
      license: 'Apache-2.0',
      description: 'Helper layer.',
    });

    // Textractor helper layer
    const textractorLayer = new lambda.LayerVersion(this, 'Textractor', {
      code: lambda.Code.fromAsset('lambda/textractor'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
      license: 'Apache-2.0',
      description: 'Textractor layer.',
    });

    //------------------------------------------------------------
    // Async Job Processor (Start jobs using Async APIs)
    const asyncProcessor = new lambda.Function(this, 'ASyncProcessor', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/asyncprocessor'),
      handler: 'lambda_function.lambda_handler',
      reservedConcurrentExecutions: 1,
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(60),
      environment: {
        SNS_TOPIC_ARN: jobCompletionTopic.topicArn,
        SNS_ROLE_ARN: textractServiceRole.roleArn,
        OUTPUT_TABLE: outputTable.tableName,
        DOCUMENTS_TABLE: documentsTable.tableName,
      }
    });

    //Layer
    asyncProcessor.addLayers(helperLayer)

    //Permissions
    contentBucket.grantRead(asyncProcessor)
    outputTable.grantReadWriteData(asyncProcessor)
    documentsTable.grantReadWriteData(asyncProcessor)
    asyncProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [textractServiceRole.roleArn]
      })
    );
    asyncProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["textract:StartDocumentTextDetection"],
        resources: ["*"]
      })
    );
    //------------------------------------------------------------

    // Async Jobs Results Processor
    const jobResultProcessor = new lambda.Function(this, 'JobResultProcessor', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/jobresultprocessor'), 
      handler: 'lambda_function.lambda_handler',
      memorySize: 2000,
      tracing: lambda.Tracing.ACTIVE,
      reservedConcurrentExecutions: 50,
      timeout: cdk.Duration.seconds(900),
      environment: {
        OUTPUT_TABLE: outputTable.tableName,
        DOCUMENTS_TABLE: documentsTable.tableName,
      }
    });
    //Layer
    jobResultProcessor.addLayers(helperLayer)
    jobResultProcessor.addLayers(textractorLayer)
    //Triggers
    jobResultProcessor.addEventSource(new SqsEventSource(jobResultsQueue, {
      batchSize: 1
    }));
    //Permissions
    outputTable.grantReadWriteData(jobResultProcessor)
    documentsTable.grantReadWriteData(jobResultProcessor)
    contentBucket.grantReadWrite(jobResultProcessor)
    jobResultProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["textract:GetDocumentTextDetection", "textract:GetDocumentAnalysis"],
        resources: ["*"]
      })
    );

    //------------------------------------------------------------

    // Summarization handler 
    const summarizationProcessor = new lambda.Function(this, 'SummarizationProcessor', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/summarizationprocessor'),
      handler: 'lambda_function.lambda_handler',
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(60),
      environment: {
        QUEUE_URL: summarizationResultsQueue.queueUrl,
        JOB_TABLE: summarizationTable.tableName,
      }
    });
    summarizationProcessor.addLayers(helperLayer)
    summarizationResultsQueue.grantSendMessages(summarizationProcessor)
    summarizationTable.grantReadWriteData(summarizationProcessor)

    // Embedding handler 
    const embeddingProcessor = new lambda.Function(this, 'EmbeddingProcessor', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/embeddingprocessor'),
      handler: 'lambda_function.lambda_handler',
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(60),
      environment: {
        QUEUE_URL: embeddingQueue.queueUrl,
        JOB_TABLE: embeddingTable.tableName,
      }
    });
    embeddingProcessor.addLayers(helperLayer)
    embeddingQueue.grantSendMessages(embeddingProcessor)
    embeddingTable.grantReadWriteData(embeddingProcessor)

    //**********API Gateway******************************
    const prdLogGroup = new logs.LogGroup(this, "PrdLogs");
    const cfnWebACLApi = new wafv2.CfnWebACL(this, 'WebAclApi', {
      defaultAction: {
        allow: {}
      },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName:'MetricForWebACLCDKApi',
        sampledRequestsEnabled: true,
      },
      name:'CdkWebAclApi',
      rules: [{
        name: 'CRSRule',
        priority: 0,
        statement: {
          managedRuleGroupStatement: {
            name:'AWSManagedRulesCommonRuleSet',
            vendorName:'AWS'
          }
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName:'MetricForWebACLCDK-CRS-Api',
          sampledRequestsEnabled: true,
        },
        overrideAction: {
          none: {}
        },
      }]
    });
    const api = new apigw.RestApi(this, 'sum-qa-api', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: apigw.Cors.DEFAULT_HEADERS,
        allowCredentials: true,
        statusCode: 200
      },
      deployOptions: {
        accessLogDestination: new apigw.LogGroupLogDestination(prdLogGroup),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true
      },
      cloudWatchRole: true,
    });
    const cfnWebACLAssociation = new wafv2.CfnWebACLAssociation(this,'ApiCDKWebACLAssociation', {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: cfnWebACLApi.attrArn,
    });
    const documentResource = api.root.addResource('doctopdf');
    const pdfToText = new apigw.LambdaIntegration(asyncProcessor);
    documentResource.addMethod('POST', pdfToText, {
      authorizationType: apigw.AuthorizationType.IAM
    })
    const summarizeResource = api.root.addResource('summarize');
    const summarizeIntegration = new apigw.LambdaIntegration(summarizationProcessor);
    summarizeResource.addMethod('POST', summarizeIntegration, {
      authorizationType: apigw.AuthorizationType.IAM
    })
    const embeddingResource = api.root.addResource('embed');
    const embeddingIntegration = new apigw.LambdaIntegration(embeddingProcessor);
    embeddingResource.addMethod('POST', embeddingIntegration, {
      authorizationType: apigw.AuthorizationType.IAM
    })
    const qaResource = api.root.addResource('qa');

    //**********Fargate tasks******************************

    const vpc = new ec2.Vpc(this, 'VPC', {
      gatewayEndpoints: {
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
      },
    });
    vpc.addFlowLog('FlowLogS3', {
      destination: ec2.FlowLogDestination.toS3(contentBucket, 'flowlogs/')
    });
    vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });
    vpc.addInterfaceEndpoint('KmsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
    });
    const endpointSum = this.node.tryGetContext('sumEndpoint');
    const endpointEmbed = this.node.tryGetContext('embedEndpoint');
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      enableFargateCapacityProviders: true,
      containerInsights: true
    });
    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'SummarizationWorkerTask', {
      memoryLimitMiB: 61440,
      cpu: 8192,
      ephemeralStorageGiB: 200,
      // Uncomment this section if running on ARM
      // runtimePlatform: {
      //   cpuArchitecture: ecs.CpuArchitecture.ARM64,
      // }
    });
    fargateTaskDefinition.grantRun(summarizationProcessor)
    contentBucket.grantRead(fargateTaskDefinition.taskRole)
    summarizationTable.grantReadWriteData(fargateTaskDefinition.taskRole)
    fargateTaskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["sagemaker:InvokeEndpoint"],
        resources: [
          "arn:aws:sagemaker:" + this.region + ":" + this.account + ":endpoint/" + endpointSum
        ]
      })
    );
    const regionParam = new ssm.StringParameter(this, 'RegionParameter', {
      parameterName: 'RegionParameter',
      stringValue: this.region,
      tier: ssm.ParameterTier.ADVANCED,
    });
    const endpointSumParam = new ssm.StringParameter(this, 'EndpointSumParameter', {
      parameterName: 'EndpointSumParameter',
      stringValue: endpointSum,
      tier: ssm.ParameterTier.ADVANCED,
    });
    const sumTableParam = new ssm.StringParameter(this, 'SumTableParameter', {
      parameterName: 'SumTableParameter',
      stringValue: summarizationTable.tableName,
      tier: ssm.ParameterTier.ADVANCED,
    });
    fargateTaskDefinition.addContainer('worker', {
      image: ecs.ContainerImage.fromAsset('fargate/summarizationworker'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'summarization-log-group', logRetention: 30 }),
      secrets: { 
        endpoint: ecs.Secret.fromSsmParameter(endpointSumParam),
        table: ecs.Secret.fromSsmParameter(sumTableParam),
        region: ecs.Secret.fromSsmParameter(regionParam)
      }
    });

    //**********ECS task launcher******************************
    const subnetIds: string[] = [];
    vpc.privateSubnets.forEach(subnet => {
      subnetIds.push(subnet.subnetId);
    });

    // Summarization worker - fires ECS task
    const taskProcessor = new lambda.Function(this, 'TaskProcessor', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/taskprocessor'), 
      handler: 'lambda_function.lambda_handler',
      tracing: lambda.Tracing.ACTIVE,
      reservedConcurrentExecutions: 50,
      timeout: cdk.Duration.seconds(30),
      environment: {
        target: cluster.clusterArn,
        taskDefinitionArn: fargateTaskDefinition.taskDefinitionArn,
        subnets: subnetIds.join(",")
      }
    });
    //Triggers
    taskProcessor.addEventSource(new SqsEventSource(summarizationResultsQueue, {
      batchSize: 1
    }));
    //Permissions
    taskProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [fargateTaskDefinition.taskDefinitionArn]
      })
    );
    taskProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: ["*"]
      })
    );

    //**********EFS*************************
    const fileSystem = new efs.FileSystem(this, 'ChromaFileSystem', {
      vpc: vpc,
      encrypted: true,
      enableAutomaticBackups: true,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE, // default
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });
    const accessPoint = fileSystem.addAccessPoint('LambdaAccessPoint',{
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '750'
      },
      path:'/export/lambda',
      posixUser: {
        gid: '1001',
        uid: '1001'
      }
    });

    //**********Function that uses EFS*************************
    const endpointQa = this.node.tryGetContext('qaEndpoint');
    const fargateTaskDefinitionEmbed = new ecs.FargateTaskDefinition(this, 'EmbedWorkerTask', {
      memoryLimitMiB: 8192,
      cpu: 4096,
      ephemeralStorageGiB: 100,
      // Uncomment this section if running on ARM
      // runtimePlatform: {
      //   cpuArchitecture: ecs.CpuArchitecture.ARM64,
      // }
    });
    const embedVolume = {
      name: "datavolume",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig:{
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        }
      },
    };
    fargateTaskDefinitionEmbed.addVolume(embedVolume);
    contentBucket.grantRead(fargateTaskDefinitionEmbed.taskRole)
    embeddingTable.grantReadWriteData(fargateTaskDefinitionEmbed.taskRole)
    fargateTaskDefinitionEmbed.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["sagemaker:InvokeEndpoint"],
        resources: [
          "arn:aws:sagemaker:" + this.region + ":" + this.account + ":endpoint/" + endpointEmbed
        ]
      })
    );
    const endpointEmbedParam = new ssm.StringParameter(this, 'EndpointEmbedParameter', {
      parameterName: 'EndpointEmbedParameter',
      stringValue: endpointEmbed,
      tier: ssm.ParameterTier.ADVANCED,
    });
    const embedTableParam = new ssm.StringParameter(this, 'EmbedTableParameter', {
      parameterName: 'EmbedTableParameter',
      stringValue: embeddingTable.tableName,
      tier: ssm.ParameterTier.ADVANCED,
    });
    const mountParam = new ssm.StringParameter(this, 'MountParameter', {
      parameterName: 'MountParameter',
      stringValue: '/efs/data',
      tier: ssm.ParameterTier.ADVANCED,
    });
    const embedContainer = fargateTaskDefinitionEmbed.addContainer('worker', {
      image: ecs.ContainerImage.fromAsset('fargate/embeddingWorker'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'embed-log-group', logRetention: 30 }),
      secrets: { 
        endpoint: ecs.Secret.fromSsmParameter(endpointEmbedParam),
        table: ecs.Secret.fromSsmParameter(embedTableParam),
        region: ecs.Secret.fromSsmParameter(regionParam),
        mountpoint: ecs.Secret.fromSsmParameter(mountParam)
      }
    });
    embedContainer.addMountPoints(
      {
        containerPath: '/efs/data',
        readOnly: false,
        sourceVolume: 'datavolume',
      }
    );
    fargateTaskDefinitionEmbed.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'elasticfilesystem:ClientRootAccess',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:DescribeMountTargets'
        ],
        resources: [fileSystem.fileSystemArn]
      })
    );
    fargateTaskDefinitionEmbed.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:DescribeAvailabilityZones'],
        resources: ['*']
      })
    );
    fileSystem.connections.allowDefaultPortFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock));
    const embeddingWorker = new lambda.Function(this, 'EmbeddingWorker', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset('lambda/embeddingworker'),
      handler: 'lambda_function.lambda_handler',
      tracing: lambda.Tracing.ACTIVE,
      memorySize: 1024,
      reservedConcurrentExecutions: 50,
      timeout: cdk.Duration.seconds(30),
      environment: {
        target: cluster.clusterArn,
        taskDefinitionArn: fargateTaskDefinitionEmbed.taskDefinitionArn,
        subnets: subnetIds.join(",")
      }
    });
    //Triggers
    embeddingWorker.addEventSource(new SqsEventSource(embeddingQueue, {
      batchSize: 1
    }));
    embeddingWorker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [fargateTaskDefinitionEmbed.taskDefinitionArn]
      })
    );
    embeddingWorker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: ["*"]
      })
    );

    //***********Cognito ************************/
    const userPool = new cognito.UserPool(this, 'userpool', {
      userPoolName: 'fsiqasumuserpool',
      selfSignUpEnabled: false,
      signInCaseSensitive: false, // case insensitive is preferred in most situations
      signInAliases: {
        username: true,
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED
    });

    const idPool = new cognitoIdp.IdentityPool(this, 'fsiIdentityPool',
      { 
        allowUnauthenticatedIdentities: false,
        authenticationProviders: {
          userPools: [new cognitoIdp.UserPoolAuthenticationProvider({ userPool })],
        },
      },
    );
    documentsTable.grantReadData(idPool.authenticatedRole)
    summarizationTable.grantReadData(idPool.authenticatedRole)
    outputTable.grantReadData(idPool.authenticatedRole)
    embeddingTable.grantReadData(idPool.authenticatedRole)
    contentBucket.grantReadWrite(idPool.authenticatedRole)
    idPool.authenticatedRole.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources: [api.arnForExecuteApi('*')],
    }));
    const cfnUserPoolGroup = new cognito.CfnUserPoolGroup(this, 'MyCfnUserPoolGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'fsigroup',
      precedence: 1,
      roleArn: idPool.authenticatedRole.roleArn
    });

    //**********ECS Service for QA******************************
    const fargateTaskDefinitionQa = new ecs.FargateTaskDefinition(this, 'QaWorkerTask', {
      memoryLimitMiB: 8192,
      cpu: 4096,
      ephemeralStorageGiB: 100,
      // Uncomment this section if running on ARM
      // runtimePlatform: {
      //   cpuArchitecture: ecs.CpuArchitecture.ARM64,
      // }
    });
    const qaVolume = {
      name: "datavolume",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig:{
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        }
      },
    };
    fargateTaskDefinitionQa.addVolume(qaVolume);
    fargateTaskDefinitionQa.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["sagemaker:InvokeEndpoint"],
        resources: [
          "arn:aws:sagemaker:" + this.region + ":" + this.account + ":endpoint/" + endpointEmbed,
          "arn:aws:sagemaker:" + this.region + ":" + this.account + ":endpoint/" + endpointQa
        ]
      })
    );
    const endpointQaParam = new ssm.StringParameter(this, 'EndpointQaParameter', {
      parameterName: 'EndpointQaParameter',
      stringValue: endpointQa,
      tier: ssm.ParameterTier.ADVANCED,
    });
    const qaContainer = fargateTaskDefinitionQa.addContainer('qaworker', {
      image: ecs.ContainerImage.fromAsset('fargate/qaWorker'),
      containerName: 'qaworker',
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'qa-log-group', logRetention: 30 }),
      portMappings: [
        { 
          containerPort: 5000,
          hostPort: 5000
        }
      ],
      secrets: { 
        endpoint_embed: ecs.Secret.fromSsmParameter(endpointEmbedParam),
        endpoint_qa: ecs.Secret.fromSsmParameter(endpointQaParam),
        mountpoint: ecs.Secret.fromSsmParameter(mountParam)
      },
      essential: true
    });
    qaContainer.addMountPoints(
      {
        containerPath: '/efs/data',
        readOnly: false,
        sourceVolume: 'datavolume',
      }
    );
    fargateTaskDefinitionQa.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'elasticfilesystem:ClientRootAccess',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:DescribeMountTargets'
        ],
        resources: [fileSystem.fileSystemArn]
      })
    );
    fargateTaskDefinitionQa.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:DescribeAvailabilityZones'],
        resources: ['*']
      })
    );
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'svcSecurityGroup', {
      vpc: vpc,
      securityGroupName: 'svcSecurityGroup'
    })
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5000),
      'Allow inbound traffic from resources in vpc'
    )
    const qaService = new ecs.FargateService(this, 'qaService', {
      serviceName: 'qaService',
      cluster: cluster,
      desiredCount: 1,
      securityGroups: [serviceSecurityGroup],
      taskDefinition: fargateTaskDefinitionQa,
      healthCheckGracePeriod: cdk.Duration.seconds(300)
    })
    const qaNLB = new elb.NetworkLoadBalancer(this, 'qaNLB', {
        loadBalancerName: 'qaNLB',
        vpc: vpc,
        crossZoneEnabled: true,
        internetFacing: false,
    })
    qaNLB.logAccessLogs(contentBucket, "nlblog")
    const qaTargetGroup = new elb.NetworkTargetGroup(this, 'qaTargetGroup', {
      targetGroupName: 'qaTargetGroup',
      vpc: vpc,
      port: 5000,
      targets: [qaService]
    })
    qaTargetGroup.configureHealthCheck({
      path: "/health",
      protocol: elb.Protocol.HTTP,
      port: "5000",
    });
    qaNLB.addListener('qaTargetGroupListener', {
      port: 80,
      defaultTargetGroups: [qaTargetGroup]
    })

    const link = new apigw.VpcLink(this, 'link', {
      targets: [qaNLB],
    });
    const qaIntegration = new apigw.Integration({
      type: apigw.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: "POST",
      options: {
        connectionType: apigw.ConnectionType.VPC_LINK,
        vpcLink: link,
      },
    });
    qaResource.addMethod('POST', qaIntegration, {
      authorizationType: apigw.AuthorizationType.IAM
    })

    //**********CloudFront******************************
    const cfnWebACL = new wafv2.CfnWebACL(this, 'WebAcl', {
            defaultAction: {
              allow: {}
            },
            scope: 'CLOUDFRONT',
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName:'MetricForWebACLCDK',
              sampledRequestsEnabled: true,
            },
            name:'CdkWebAcl',
            rules: [{
              name: 'CRSRule',
              priority: 0,
              statement: {
                managedRuleGroupStatement: {
                  name:'AWSManagedRulesCommonRuleSet',
                  vendorName:'AWS'
                }
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName:'MetricForWebACLCDK-CRS',
                sampledRequestsEnabled: true,
              },
              overrideAction: {
                none: {}
              },
            }]
          });
    const distribution = new cloudfront.Distribution(this, 'appdist', {
      defaultBehavior: { origin: new origins.S3Origin(appBucket) },
      enableLogging: true, 
      logBucket: contentBucket,
      logFilePrefix: 'distribution-access-logs/',
      logIncludesCookies: true,
      geoRestriction: cloudfront.GeoRestriction.allowlist('US'),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: cfnWebACL.attrArn
    });

    //**********Outputs******************************
    new cdk.CfnOutput(this, 'DocToPdfApiUrl', {
      value: `${api.url}doctopdf`,
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: `${userPool.userPoolId}`,
    });
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: `${idPool.identityPoolId}`,
    });
    new cdk.CfnOutput(this, 'UserPoolGroupName', {
      value: `${cfnUserPoolGroup.groupName}`,
    });
    new cdk.CfnOutput(this, 'SummarizeUrl', {
      value: `${api.url}summarize`,
    });
    new cdk.CfnOutput(this, 'BucketName', {
      value: `${contentBucket.bucketName}`,
    });
    new cdk.CfnOutput(this, 'OutputTableName', {
      value: `${outputTable.tableName}`,
    });
    new cdk.CfnOutput(this, 'DocumentTableName', {
      value: `${documentsTable.tableName}`,
    });
    new cdk.CfnOutput(this, 'AppBucketName', {
      value: `${appBucket.bucketName}`,
    });
    new cdk.CfnOutput(this, 'AppUrl', {
      value: `${distribution.domainName}`,
    });
  }
}
