# Project Setup

## Prerequisites

* An AWS account
* A credit card 
* A working internet connection
* A terminal of your choice

> ⚠️: I recommend setting a **billing alarm** in the AWS billing console to prevent a big invoice from AWS. ElastiCache will be the culprit, don't ask me why I know ;)

## Create AWS account and install `aws` CLI

## Package Application Source Code

```sh
$ cd fetch-board
$ zip -r fetch_Board_S3.zip fetch_board_s3.py
$ cd ../place-api-handler
$ zip -r place_api_handler.zip .
$ cd ../board-snapshots
$ zip -r board_snapshots.zip .
$ aws s3 mb s3://{your_bucket_name}
$ aws s3 cp board_snapshots.zip s3://{your_bucket_name}
$ aws s3 cp place_api_handler.zip s3://{your_bucket_name}
$ aws s3 cp fetch_Board_S3.zip s3://{your_bucket_name}
```

## Deploy Cloudformation Stack

To deploy the cloudformation stack, you may use either the command below or the management console (see screenshots below)

```bash
$ aws cloudformation create-stack --stack-name pixel-party --template-body file://cfn-templates/project_stack1.yaml --parameters ParameterKey=SourcesBucket,ParameterValue={your_bucket_name} --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM --output text
```

To take down the application, simply invoke the command below:

```bash
$ aws cloudformation delete-stack --stack-name pixel-party
```