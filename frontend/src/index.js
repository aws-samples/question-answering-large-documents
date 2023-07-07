/* 
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
*/
import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import { Amplify, Auth, Storage, API } from "aws-amplify";
import config from "./config";
import { ToastContainer, toast } from 'react-toastify';

//Amplify.Logger.LOG_LEVEL = 'DEBUG';
Amplify.configure({
  Auth: {
    mandatorySignIn: true,
    region: config.cognito.REGION,
    userPoolId: config.cognito.USER_POOL_ID,
    identityPoolId: config.cognito.IDENTITY_POOL_ID,
    userPoolWebClientId: config.cognito.APP_CLIENT_ID
  },
  Storage: {
    AWSS3: {
      bucket: config.content.bucket,
      region: config.content.REGION,
    },
    customPrefix: {
      public: config.content.prefix,
      protected: config.content.prefix,
      private: config.content.prefix,
  },
  },
  API: {
    endpoints: [
      {
        name: "docs",
        endpoint: config.apiGateway.URL,
        region: config.apiGateway.REGION
      },
    ]
  }
});

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);

