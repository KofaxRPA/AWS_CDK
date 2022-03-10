import cdk = require('aws-cdk-lib');
import ec2 = require('aws-cdk-lib/aws-ec2');
import ecr = require('aws-cdk-lib/aws-ecr');
import ecs = require('aws-cdk-lib/aws-ecs')
import s3 = require('aws-cdk-lib/aws-s3');
import iam = require('aws-cdk-lib/aws-iam');
import route53 = require('aws-cdk-lib/aws-route53');
import route53targets = require('aws-cdk-lib/aws-route53-targets');
import certificatemanager = require('aws-cdk-lib/aws-certificatemanager');
import elasticloadbalancing = require('aws-cdk-lib/aws-elasticloadbalancingv2');
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class SampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

 
    const clientName = "sample"; 
    const environment = "dev-549273";
    const domain = "subdomain.1demo.space";
    const clientPrefix = `${clientName}-${environment}-server`;
    const xvpcId = "vpc-dbdc0ba2";  //default
 
    const vpc = ec2.Vpc.fromLookup(this, `${clientPrefix}-vpc`, {
      vpcId: xvpcId,
    });
    
     const repository = new ecr.Repository(this, `${clientPrefix}-repository`, {
      repositoryName: `${clientPrefix}-repository`,
    });

    // The code that defines your stack goes here
    const cluster = new ecs.Cluster(this, `${clientPrefix}-cluster`, {
      clusterName: `${clientPrefix}-cluster`,
      vpc,
    });
    
    
     // load balancer resources
    const elb = new elasticloadbalancing.ApplicationLoadBalancer(
      this,
      `${clientPrefix}-elb`,
      {
        vpc,
        vpcSubnets: { subnets: vpc.publicSubnets },
        internetFacing: true,
      }
    );
    
    const zone = route53.HostedZone.fromLookup(this, `${clientPrefix}-zone`, {
      domainName: domain,
    });

    new route53.ARecord(this, `${clientPrefix}-domain`, {
      recordName: `${environment}api.${domain}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.LoadBalancerTarget(elb)
      ),
      ttl: cdk.Duration.seconds(300),
      comment: `${environment} API domain`,
      zone: zone,
    });

    const targetGroupHttp = new elasticloadbalancing.ApplicationTargetGroup(
      this,
      `${clientPrefix}-target`,
      {
        port: 80,
        vpc,
        protocol: elasticloadbalancing.ApplicationProtocol.HTTP,
        targetType: elasticloadbalancing.TargetType.IP,
      }
    );

    targetGroupHttp.configureHealthCheck({
      path: "/api/status",
      protocol: elasticloadbalancing.Protocol.HTTP,
      port: "8080",
    });

    const cert = new certificatemanager.Certificate(
      this,
      `${clientPrefix}-cert`,
      {
        domainName: domain,
        subjectAlternativeNames: [`*.${domain}`],
        validation: certificatemanager.CertificateValidation.fromDns(zone),
      }
    );
    const listener = elb.addListener("Listener", {
      open: true,
      port: 443,
      certificates: [cert],
    });

    listener.addTargetGroups(`${clientPrefix}-tg`, {
      targetGroups: [targetGroupHttp],
    });

     

    const elbSG = new ec2.SecurityGroup(this, `${clientPrefix}-elbSG`, {
      vpc,
      allowAllOutbound: true,
    });

    elbSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow https traffic"
    );
    
    
    elb.addSecurityGroup(elbSG);

    const bucket = new s3.Bucket(this, `${clientPrefix}-s3-bucket`, {
      bucketName: `${clientName}-${environment}-assets`,
    });

    const taskRole = new iam.Role(this, `${clientPrefix}-task-role`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: `${clientPrefix}-task-role`,
      description: "Role that the api task definitions use to run the api code",
    });

    taskRole.attachInlinePolicy(
      new iam.Policy(this, `${clientPrefix}-task-policy`, {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["S3:*"],
            resources: [bucket.bucketArn],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["SES:*"],
            resources: ["*"],
          }),
        ],
      })
    );
    
    const taskDefinition = new ecs.TaskDefinition(
      this,
      `${clientPrefix}-task`,
      {
        family: `${clientPrefix}-task`,
        compatibility: ecs.Compatibility.EC2_AND_FARGATE,
        cpu: "256",
        memoryMiB: "512",
        networkMode: ecs.NetworkMode.AWS_VPC,
        taskRole: taskRole,
      }
    );

    //const image = ecs.RepositoryImage.fromEcrRepository(repository, "latest");
    const image =  ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"); 

    const container = taskDefinition.addContainer(`${clientPrefix}-container`, {
      image: image,
      memoryLimitMiB: 512,
      environment: undefined,
      logging: ecs.LogDriver.awsLogs({ streamPrefix: clientPrefix }),
    });

    container.addPortMappings({ containerPort: 80 });

    const ecsSG = new ec2.SecurityGroup(this, `${clientPrefix}-ecsSG`, {
      vpc,
      allowAllOutbound: true,
    });

    ecsSG.connections.allowFrom(
      elbSG,
      ec2.Port.allTcp(),
      "Application load balancer"
    );

    const service = new ecs.FargateService(this, `${clientPrefix}-service`, {
      cluster,
      desiredCount: 1,
      taskDefinition,
      securityGroups: [ecsSG],
      assignPublicIp: true,
    });

    service.attachToApplicationTargetGroup(targetGroupHttp);

    const scalableTaget = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5,
    });

    scalableTaget.scaleOnMemoryUtilization(`${clientPrefix}-ScaleUpMem`, {
      targetUtilizationPercent: 75,
    });

    scalableTaget.scaleOnCpuUtilization(`${clientPrefix}-ScaleUpCPU`, {
      targetUtilizationPercent: 75,
    });

    // outputs to be used in code deployments
    new cdk.CfnOutput(this, `${environment}ServiceName`, {
      exportName: `${environment}ServiceName`,
      value: service.serviceName,
    });
    
  /*  new cdk.CfnOutput(this, `${environment}ImageName`, {
      exportName: `${environment}ImageName`,
      value: image.imageName,
    });
*/
    new cdk.CfnOutput(this, `${environment}ImageRepositoryUri`, {
      exportName: `${environment}ImageRepositoryUri`,
      value: repository.repositoryUri,
    });



    new cdk.CfnOutput(this, `${environment}ClusterName`, {
      exportName: `${environment}ClusterName`,
      value: cluster.clusterName,
    });
    
    
  }
}
