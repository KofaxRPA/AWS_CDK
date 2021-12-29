import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import ecs_patterns = require('@aws-cdk/aws-ecs-patterns');
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import { OriginProtocolPolicy } from '@aws-cdk/aws-cloudfront'

import * as cdk from '@aws-cdk/core';

export class CdkSampleStack extends cdk.Stack {
  public readonly postsContentDistrubtion: cloudfront.Distribution;
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Create VPC and Fargate Cluster
    // NOTE: Limit AZs to avoid reaching resource quotas
    const vpc = new ec2.Vpc(this, 'MyVpc', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    // Instantiate Fargate Service with just cluster and image

    // we create an Application Load Balancer
    var lb = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "FargateService", {
      cluster,
      taskImageOptions: {
        // https://docs.aws.amazon.com/cdk/api/latest/docs/aws-ecs-patterns-readme.html
        image: ecs.ContainerImage.fromRegistry("postgres:10"),
        environment: {
          TEST_ENVIRONMENT_VARIABLE1: "test environment variable 1 value",
          TEST_ENVIRONMENT_VARIABLE2: "test environment variable 2 value",
        },
        //add 3  containers (MC, roboserver, database) to 1 task as in 
        // https://github.com/aws-samples/aws-cdk-examples/blob/08600cd2c0080994c9d4d478b259a8213a786272/typescript/ecs/ecs-service-with-task-placement/index.ts#L21
      },
    });

    //Create a new cloudfront distribution, using a a source the lb
    this.postsContentDistrubtion = new cloudfront.Distribution(
      this,
      "PostsContentDistribution",
      {
        defaultBehavior: {
          //disables HTTPS because we don't have a publicly trusted certificate
          origin: new origins.LoadBalancerV2Origin(lb.loadBalancer,{protocolPolicy: OriginProtocolPolicy.HTTP_ONLY}),
        },
      }
    );
    
  }
}