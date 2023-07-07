#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

USERNAME=$1
EMAIL=$2
PASSWORD=$3
USERPOOLID=$4
CLIENTID=$5
GROUPNAME=$6


if [ "$USERNAME" == "" ]
then
    echo "Usage: $0 <user name> <password> <user pool id> <client id> <group name>"
    exit 1
fi
if [ "$EMAIL" == "" ]
then
    echo "Usage: $0 <user name> <password> <user pool id> <client id> <group name>"
    exit 1
fi
if [ "$PASSWORD" == "" ]
then
    echo "Usage: $0 <user name> <password> <user pool id> <client id> <group name>"
    exit 1
fi
if [ "$USERPOOLID" == "" ]
then
    echo "Usage: $0 <user name> <password> <user pool id> <client id> <group name>"
    exit 1
fi
if [ "$CLIENTID" == "" ]
then
    echo "Usage: $0 <user name> <password> <user pool id> <client id> <group name>"
    exit 1
fi
if [ "$GROUPNAME" == "" ]
then
    echo "Usage: $0 <user name> <password> <user pool id> <client id> <group name>"
    exit 1
fi

aws cognito-idp update-user-pool-client --user-pool-id ${USERPOOLID} --client-id ${CLIENTID} --explicit-auth-flows ADMIN_NO_SRP_AUTH

aws cognito-idp sign-up --client-id ${CLIENTID} --username ${USERNAME} --password ${PASSWORD} --user-attributes "[ { \"Name\": \"email\", \"Value\": \"$EMAIL\" }, { \"Name\": \"phone_number\", \"Value\": \"+12485551212\" }]"

aws cognito-idp admin-confirm-sign-up --user-pool-id ${USERPOOLID} --username ${USERNAME}

cat << EOF > /tmp/authflow.json
{ "AuthFlow": "ADMIN_NO_SRP_AUTH", "AuthParameters": { "USERNAME": "${USERNAME}", "PASSWORD": "${PASSWORD}" } }
EOF

JWT_ID_TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id ${USERPOOLID} --client-id ${CLIENTID} --cli-input-json file:///tmp/authflow.json --query AuthenticationResult.IdToken --output text)

aws cognito-idp admin-add-user-to-group --user-pool-id ${USERPOOLID} --username $USERNAME --group-name $GROUPNAME
