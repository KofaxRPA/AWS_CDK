import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import ecs_patterns = require('@aws-cdk/aws-ecs-patterns');
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import { OriginProtocolPolicy } from '@aws-cdk/aws-cloudfront'
import { AutoScalingGroup } from '@aws-cdk/aws-autoscaling';  // for elbv2
import elbv2 = require ('@aws-cdk/aws-elasticloadbalancingv2');
import {Role, ServicePrincipal, PolicyStatement} from  '@aws-cdk/aws-iam'
import * as cdk from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-ecr';
import { Expiration } from '@aws-cdk/core';
import { LogDrivers } from '@aws-cdk/aws-ecs';
import * as logs from '@aws-cdk/aws-logs';

// //A stack is a collection of AWS resources that you can manage as a single unit in AWS CloudFront.
// //All the resources in a stack are defined by the stack's AWS CloudFormation template
export class KofaxRPAStack extends cdk.Stack {
  public readonly postsContentDistrubtion: cloudfront.Distribution;
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Create VPC (virtual private cloud) on Amazon Web Service
    // NOTE: Limit AZs to avoid reaching resource quotas
    const vpc = new ec2.Vpc(this, 'MyVpc', { maxAzs: 2 }); //AZ=Availability Zone within a region.
    // Create a cluster (logical grouping of tasks or services) on ECS=Elastic Cloud Services
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc }); 
    //task definition = json that describes 1 to 10 containers.
    //task = instance of a task definition running in a cluster
    //service runs and maintains tasks simultaneously. see scheduling.
    // a service can only be associated with one task definition. 
    //       A service can run 2 tasks, but they are both instances of the same one task defintion
    //when tasks are run on Fargate your cluster resources are managed by Fargate.
    //
    //https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.FargateTaskDefinition.html

    // const role = new Role(this, 'MyRole', {
    //   assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    // });

    // role.addToPolicy(new PolicyStatement({
    //   resources: ['all'],
    //   actions: [       
    //     "ecr:GetAuthorizationToken",
    //     "ecr:BatchCheckLayerAvailability",
    //     "ecr:GetDownloadUrlForLayer",
    //     "ecr:BatchGetImage",
    //     "logs:CreateLogStream",
    //     "logs:PutLogEvents"
    //   ],
    // }));


    //Defining a parameter
    // const uploadBucketName = new CfnParameter(this, "uploadBucketName", {
    //   type: "String",
    //   description: "The name of the Amazon S3 bucket where uploaded files will be stored."});
    //using a parameter  uploadBucketName.toString
    //cdk deploy --parameters uploadBucketName=UploadBucket

    
    // Attach loggers to our docker containers
    // View STDOUT/STDERR logs at AWS Cloudwatch/logs/loggroups https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#logsV2:log-groups
    // or at ECS/clusters/cluster/task/container/log will give a link to Cloudwatch
    const logDriver_pg=new ecs.AwsLogDriver({
      //logGroup : 'KofaxRPA_postgresslogdriver',
      streamPrefix: 'postgres', 
      mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      logRetention : logs.RetentionDays.THREE_DAYS  // keep logs for 3 days
    })
    const logDriver_mc=new ecs.AwsLogDriver({
      streamPrefix: 'mc', 
      mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      logRetention : logs.RetentionDays.THREE_DAYS  // keep logs for 3 days
    })
    const logDriver_rs=new ecs.AwsLogDriver({
      streamPrefix: 'rs', 
      mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      logRetention : logs.RetentionDays.THREE_DAYS  // keep logs for 3 days
    })

    // Fargate manages applications without concerning us with server instances
    const taskDefinition_pg = new ecs.FargateTaskDefinition(this, 'TaskDef-KofaxRPA-pg',
      {
        memoryLimitMiB: 512,   //default=512
        cpu: 256,   //default=256
        // executionRole: role
      }
    );
    const taskDefinition_mc = new ecs.FargateTaskDefinition(this, 'TaskDef-KofaxRPA-mc',
      {
        memoryLimitMiB: 512,   //default=512
        cpu: 256,   //default=256
        // executionRole: role
      }
    );
    const taskDefinition_rs = new ecs.FargateTaskDefinition(this, 'TaskDef-KofaxRPA-rs',
    {
      memoryLimitMiB: 512,   //default=512
      cpu: 256,   //default=256
      // executionRole: role
    }
  );
    const container_pg = taskDefinition_pg.addContainer('postgres-service',
      {
        image: ecs.ContainerImage.fromRegistry('postgres:10'),
        environment:
        {
          POSTGRES_USER: "scheduler",
          POSTGRES_PASSWORD: "schedulerpassword",
          POSTGRES_DB: "scheduler",
          //how to add secrets https://faun.pub/deploying-docker-container-with-secrets-using-aws-and-cdk-8ff603092666
        },
        memoryLimitMiB: 256,
        logging: logDriver_pg // https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.AwsLogDriverProps.html
        // https://docs.docker.com/config/containers/logging/configure/
      }
    );    
    // ARN = Amazon Resource Name, unique identifier for an AWS resource.
    // we will need to use ARNs (role will be automatically created to get image from ECR and to be able to log) when doing this for customers...
    const MCRepo=Repository.fromRepositoryName(this,'mcRepo',"managementconsole");
    const RSRepo=Repository.fromRepositoryName(this,'rsRepo',"roboserver");

    const container_mc = taskDefinition_mc.addContainer('managementconsole-service',  // runs Apache Tomcat on port 8080
      {
       // I only want one MC. so it should be in it's task 
        image: ecs.ContainerImage.fromEcrRepository(MCRepo,"latest"),
        //('022336740566.dkr.ecr.eu-central-1.amazonaws.com/managementconsole:latest'),
        environment:
        {
          CONTEXT_RESOURCE_VALIDATIONQUERY: "SELECT 1",
          CONTEXT_RESOURCE_USERNAME: "scheduler",
          CONTEXT_RESOURCE_PASSWORD: "schedulerpassword",
          CONTEXT_RESOURCE_DRIVERCLASSNAME: "org.postgresql.Driver",
          CONTEXT_RESOURCE_URL: "jdbc:postgresql://postgres-service:5432/scheduler",
          CONFIG_LICENSE_NAME: "david wright",
          CONFIG_LICENSE_EMAIL: "david.wright@kofax.com",
          CONFIG_LICENSE_COMPANY: "david wright S0000047800",
          CONFIG_LICENSE_PRODUCTIONKEY: "",
          CONFIG_LICENSE_NONPRODUCTIONKEY: "ixayBQcAgYKAgAAB6S2BaFdJ",
          SETTINGS_CLUSTER_COUNT: "1",
          SETTINGS_CLUSTER_NAME_1: "Non Production",
          SETTINGS_CLUSTER_PRODUCTION_1: "false ",
          MC_ADMIN_NAME: "admin",
          MC_ADMIN_PASSWORD: "admin",
          // 1st Robot developer details
          DEV_NAME: "david",
          DEV_PASSWORD: "abc",
          DEV_FULLNAME: "David Wright",
          DEV_EMAIL: "david.wright@kofax.com",
          // MC needs to create the Roboserver and Synchronizer user accounts
          ROBOSERVER_MC_USERNAME: "roboserver",
          ROBOSERVER_MC_PASSWORD: "rob123",
          SYNCH_MC_USERNAME: "synch",
          SYNCH_MC_PASSWORD: "synch123",
          // Use Postgres as the log database
          SETTINGS_ENTRY_COUNT: "7",
          SETTINGS_ENTRY_KEY_1: "USE_LOGDB",
          SETTINGS_ENTRY_VALUE_1: "true",
          SETTINGS_ENTRY_KEY_2: "LOGDB_SCHEMA",
          SETTINGS_ENTRY_VALUE_2: "scheduler",
          SETTINGS_ENTRY_KEY_3: "LOGDB_HOST",
          SETTINGS_ENTRY_VALUE_3: "postgres-service:5432",
          SETTINGS_ENTRY_KEY_4: "LOGDB_TYPE",
          SETTINGS_ENTRY_VALUE_4: "PostgreSQL",
          // if you want to log to a separate database than MC's database 'scheduler' you'll need a second container.
          SETTINGS_ENTRY_KEY_5: "LOGDB_USERNAME",
          SETTINGS_ENTRY_VALUE_5: "scheduler",
          SETTINGS_ENTRY_KEY_6: "LOGDB_PASSWORD",
          SETTINGS_ENTRY_VALUE_6: "schedulerpassword",
          // Allow Design Studio to download JDBC driver's from MC.
          // CONFIG_SECURITY_JDBCDRIVERUPLOAD: "ANY_HOST",
          // base url - this is how a user would find the Management Console
          SETTINGS_ENTRY_KEY_7: "BASE_URL",
          SETTINGS_ENTRY_VALUE_7: "http://yourwebsite.com:8080",
    
          //how to add secrets https://faun.pub/deploying-docker-container-with-secrets-using-aws-and-cdk-8ff603092666
        },
        logging: logDriver_mc
        // do we need to add a network so the 3 containers see each other??
        // how do I add container dependency
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
        // when using Fargate the network mode is "awsvpc". All 3 would be able to see each other. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html
      }
    );
    // declare const contDep: ecs.ContainerDefinition;
    // MC is dep on postgres
    // dependsOn : {"postgres"}  //https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.ContainerDependency.html
    const contdep: ecs.ContainerDependency = {
        container : container_pg,
       // condition : ecs.ContainerDependencyCondition.COMPLETE
      };
    //container_mc.addContainerDependencies(contdep);
    container_mc.addPortMappings
    ({
      containerPort: 8080,  // tomcat
      // hostPort: 443,   // load balancer
      protocol: ecs.Protocol.TCP,
    });
    const container_rs = taskDefinition_rs.addContainer('roboserver-service',
      {
        //images should be public for the customers.
        //while not public we need permissions https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
        //https://docs.aws.amazon.com/cdk/api/v1/docs/aws-iam-readme.html        
        image: ecs.ContainerImage.fromEcrRepository(RSRepo,"latest"),
        environment:
        {
          ROBOSERVER_ENABLE_MC_REGISTRATION: "true",
          ROBOSERVER_MC_URL: "http://managementconsole-service:8080/",
          ROBOSERVER_MC_CLUSTER: "Non Production",
          ROBOSERVER_MC_USERNAME: "roboserver",
          ROBOSERVER_MC_PASSWORD: "rob123",
          ROBOSERVER_ENABLE_SOCKET_SERVICE: "true",
          ROBOSERVER_SERVER_NAME: "Roboserver",
          WRAPPER_MAX_MEMORY: "2048",
        },
        logging: logDriver_rs
      }
      // add cpu scaling. if 50% CPU for 20 seconds then add a new Fargate instance.
      // Do i need to create a separate task for roboserver to support CPU scaling?
    );
    // const app = new cdk.App();
    // const stack = new cdk.Stack(app, 'aws-ecs-integ-ecs');
    const service_pg = new ecs.FargateService(this, 'Service-KofaxRPA-pg', {
      cluster,
      taskDefinition: taskDefinition_pg,
    });
    const service_ms = new ecs.FargateService(this, 'Service-KofaxRPA-mc', {
      cluster,
      taskDefinition: taskDefinition_mc,
    });
    const service_rs = new ecs.FargateService(this, 'Service-KofaxRPA-rs', {
      cluster,
      taskDefinition: taskDefinition_rs,
    });
    // service.addPlacementStrategies(
    //   ecs.PlacementStrategy.packedBy(ecs.BinPackResource.MEMORY), 
    //   ecs.PlacementStrategy.spreadAcross(ecs.BuiltInAttributes.AVAILABILITY_ZONE));
    
    // we create an Application Load Balancer
    // elb = Elastic Load Balancer  https://docs.aws.amazon.com/cdk/api/latest/docs/aws-elasticloadbalancingv2-readme.html
    var lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {vpc, internetFacing: true });
    const listener = lb.addListener('Listener', { port: 80 });   // 443 = HTTPS
    service_ms.registerLoadBalancerTargets(
      {
        containerName: 'managementconsole-service',
        containerPort: 8080,
        newTargetGroupId: 'ECS',
        listener: ecs.ListenerConfig.applicationListener(listener, {
          protocol: elbv2.ApplicationProtocol.HTTP
        }),
      },
    );

    //      Cloudfront (HTTPS)  -->> LB   -->> ECS (containers)    
    //      cloudfront address is public AND lb address is also public but unknown. (security by obscurity)

        //   LB (HTTP)   -->> ECS (containers)    


    // var lb = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "FargateService", {
    //   cluster,
    //   taskImageOptions: {
    //     // https://docs.aws.amazon.com/cdk/api/latest/docs/aws-ecs-patterns-readme.html
    //     image: ecs.ContainerImage.fromRegistry("postgres:10"),
    //     environment: {
    //       TEST_ENVIRONMENT_VARIABLE1: "test environment variable 1 value",
    //       TEST_ENVIRONMENT_VARIABLE2: "test environment variable 2 value",
    //       //how to add secrets https://faun.pub/deploying-docker-container-with-secrets-using-aws-and-cdk-8ff603092666
    //     },

        //need to add clusters to a Fargate Task Definition to get port mappings
        // .addPortMappings({   //https://faun.pub/deploying-docker-container-with-secrets-using-aws-and-cdk-8ff603092666
        //   containerPort: 8000,
        // });
        //add 3  containers (MC, roboserver, database) to 1 task as in 
        // https://github.com/aws-samples/aws-cdk-examples/blob/08600cd2c0080994c9d4d478b259a8213a786272/typescript/ecs/ecs-service-with-task-placement/index.ts#L21
    //   },
    // });

    //Create a new cloudfront distribution, using a a source the lb
    // this.postsContentDistrubtion = new cloudfront.Distribution(
    //   this,
    //   "PostsContentDistribution",
    //   {
    //     // defaultBehavior: {
    //       //disables HTTPS because we don't have a publicly trusted certificate
    //       // origin: new origins.LoadBalancerV2Origin(lb.loadBalancer,{protocolPolicy: OriginProtocolPolicy.HTTP_ONLY}),
    //     },
    //   }
    // );
    
  }
}