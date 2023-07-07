/* 
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
*/
export default {
    apiGateway: {
      REGION: "<AWS REGION NAME>",
      URL: "<API GATEWAY STAGE URL>"
    },
    cognito: {
      REGION: "<AWS REGION NAME>",
      USER_POOL_ID: "<USER POOL ID>",
      APP_CLIENT_ID: "<APP CLIENT ID>",
      IDENTITY_POOL_ID: "<IDENTITY POOL ID>,
    },
    content: {
      bucket: "cdkstack-documentsbucket9ec9deb9-t7lgk3l18gaa",
      REGION: "<AWS REGION NAME>",
      prefix: "uploads/"
    },
    tables: {
        jobtable: "<DYNAMODB TABLE NAME>",
        ejobtable: "<DYNAMODB TABLE NAME>",
        outputtable: "<DYNAMODB TABLE NAME>",
        sumtable: "<DYNAMODB TABLE NAME>"
    }
  };
  
