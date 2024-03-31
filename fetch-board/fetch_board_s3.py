import json
import boto3

s3 = boto3.resource('s3') 


def lambda_handler(event, context):

    content_object = s3.Object('project-bucket-abc', 'board.json')
    file_content = content_object.get()['Body'].read().decode('utf-8')
    json_content = json.loads(file_content)
    
    print(json_content)
    # TODO implement
    return {
        'statusCode': 200,
        'body': json_content,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            "Access-Control-Allow-Methods":"GET"
        }
    }
