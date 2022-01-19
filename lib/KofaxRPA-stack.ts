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
import { DnsRecordType } from "@aws-cdk/aws-servicediscovery";
import * as servicediscovery from "@aws-cdk/aws-servicediscovery"
// //A stack is a collection of AWS resources that you can manage as a single unit in AWS CloudFront.
// //All the resources in a stack are defined by the stack's AWS CloudFormation template
export class KofaxRPAStack extends cdk.Stack {
  public readonly postsContentDistrubtion: cloudfront.Distribution;
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Create VPC and Fargate Cluster
    // NOTE: Limit AZs to avoid reaching resource quotas
    const vpc = new ec2.Vpc(this, 'MyVpc', { maxAzs: 2 }); //AZ=Availability Zone within a region.
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc }); // logical grouping of tasks or services
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


    // View STDOUT/STDERR logs at AWS Cloudwatch/logs/loggroups https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#logsV2:log-groups
    // or at ECS/clusters/cluster/task/container/log will give a link to Cloudwatch
    const LogDriver_pg=new ecs.AwsLogDriver({
      //logGroup : 'KofaxRPA_postgresslogdriver',
      streamPrefix: 'postgres', 
      mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      logRetention : logs.RetentionDays.THREE_DAYS  // keep logs for 3 days
   })
   const LogDriver_mc=new ecs.AwsLogDriver({
    streamPrefix: 'mc', 
    mode: ecs.AwsLogDriverMode.NON_BLOCKING,
    logRetention : logs.RetentionDays.THREE_DAYS  // keep logs for 3 days
  })

  const taskDefinition_pg = new ecs.FargateTaskDefinition(this, 't-pg',
  {
    // Memory & CPU values must be compatible. Hover mouse over "memoryLimitMiB" to see values
    // otherwise you get error "Create TaskDefinition: No Fargate configuration exists for given values"
    // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
    memoryLimitMiB: 512,   //default=512
    cpu: 256,   //default=256
    // executionRole: role
  });
  const taskDefinition_mc = new ecs.FargateTaskDefinition(this, 't-mc',
  {
    memoryLimitMiB: 1024,   //default=512
    cpu: 512,   //default=256
    // executionRole: role
  });
  const taskDefinition_rs = new ecs.FargateTaskDefinition(this, 't-rs',
  {
    memoryLimitMiB: 512,   //default=512
    cpu: 256,   //default=256
    // executionRole: role
  });
    const container_pg = taskDefinition_pg.addContainer('postgres',
      {
        image: ecs.ContainerImage.fromRegistry('postgres:10'),
        environment:
        {
          POSTGRES_USER: "scheduler",
          POSTGRES_PASSWORD: "schedulerpassword",
          POSTGRES_DB: "scheduler",
        },
        memoryLimitMiB: 256,
        logging: LogDriver_pg // https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.AwsLogDriverProps.html
        // https://docs.docker.com/config/containers/logging/configure/
      }
    );    
    // ARN = Amazon Resource Name, unique identifier for an AWS resource.
    // we will need to use ARNs (role will be automatically created to get image from ECR and to be able to log) when doing this for customers...
    const MCRepo=Repository.fromRepositoryName(this,'mcRepo',"managementconsole");
    const RSRepo=Repository.fromRepositoryName(this,'rsRepo',"roboserver");

    const container_mc = taskDefinition_mc.addContainer('mc',  // runs Apache Tomcat on port 8080
      {
       // I only want one MC. so it should be in it's own task 
        image: ecs.ContainerImage.fromEcrRepository(MCRepo,"latest"),
        //('022336740566.dkr.ecr.eu-central-1.amazonaws.com/managementconsole:latest'),
        environment:
        {
          POSTGRES_USER: "scheduler",
          CONTEXT_RESOURCE_VALIDATIONQUERY: "SELECT 1",
          POSTGRES_PASSWORD: "schedulerpassword",
          CONTEXT_RESOURCE_USERNAME: "scheduler",
          POSTGRES_DB: "scheduler",
          CONTEXT_RESOURCE_PASSWORD: "schedulerpassword",
          CONTEXT_RESOURCE_DRIVERCLASSNAME: "org.postgresql.Driver",
          CONTEXT_RESOURCE_URL: "jdbc:postgresql://postgres-service.dnsnamespaceRPA:5432/scheduler",
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
          SETTINGS_ENTRY_VALUE_3: "postgres-service.dnsnamespaceRPA:5432",
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
        },
        logging: LogDriver_mc
        // do we need to add a network so the 3 containers see each other??
        // how do I add container dependency
        // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
        // when using Fargate the network mode is "awsvpc". All 3 would be able to see each other. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html
      }
    );
    // declare const contDep: ecs.ContainerDefinition;
    // MC is dep on postgres
    dependsOn : {"postgres"}  //https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.ContainerDependency.html
    const contdep: ecs.ContainerDependency = {
        container : container_pg,
      //  condition : ecs.ContainerDependencyCondition.COMPLETE
      };
    // container_mc.addContainerDependencies(contdep);
    container_mc.addPortMappings
    ({
      containerPort: 8080,  // tomcat
      // hostPort: 443,   // load balancer
      protocol: ecs.Protocol.TCP,
    });
    // container_pg.addPortMappings
    // ({
    //   containerPort: 5432,  // postgres
    //   // hostPort: 443,   // load balancer
    //   protocol: ecs.Protocol.TCP,
    // });
    const container_rs = taskDefinition_rs.addContainer('rs',
      {
        //images should be public for the customers.
        //while not public we need permissions https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html
        //https://docs.aws.amazon.com/cdk/api/v1/docs/aws-iam-readme.html        
        image: ecs.ContainerImage.fromEcrRepository(RSRepo,"latest"),
      }
      // add cpu scaling. if 50% CPU for 20 seconds then add a new Fargate instance.
      // Do i need to create a separate task for roboserver to support CPU scaling?
    );
    // const app = new cdk.App();
    // const stack = new cdk.Stack(app, 'aws-ecs-integ-ecs');
    const dnsNamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      "DnsNamespace",
      {
        name: "dnsnamespaceRPA",
        vpc: vpc,
        description: "Private DnsNamespace for my Microservices",
      }
    );
    const service_pg = new ecs.FargateService(this, 's-pg', {
      cluster,
      taskDefinition: taskDefinition_pg,
      enableExecuteCommand: true,  // enables shell access to container via AWS CLI https://docs.aws.amazon.com/cdk/api/v1/docs/aws-ecs-readme.html#ecs-exec-command
      cloudMapOptions: {
        // This will be your service_name.namespace
        name: "postgres-service",
        cloudMapNamespace: dnsNamespace,
        dnsRecordType: DnsRecordType.A,
      },
    });
    const service_mc = new ecs.FargateService(this, 's-mc', {
      cluster,
      taskDefinition: taskDefinition_mc,
      enableExecuteCommand: true,
      cloudMapOptions: {
        // This will be your service_name.namespace
        name: "managementconsole-service",
        cloudMapNamespace: dnsNamespace,
        dnsRecordType: DnsRecordType.A,
      },
    });
    const service_rs = new ecs.FargateService(this, 's-rs', {
      cluster,
      taskDefinition: taskDefinition_rs,
      //name: "roboserver-service",
      enableExecuteCommand: true,
      
      
   //   securityGroups: {list. TODO!!!} //https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-ecs.FargateService.html#securitygroups
      //https://bobbyhadz.com/blog/aws-cdk-security-group-example


    });
    // service.addPlacementStrategies(
    //   ecs.PlacementStrategy.packedBy(ecs.BinPackResource.MEMORY), 
    //   ecs.PlacementStrategy.spreadAcross(ecs.BuiltInAttributes.AVAILABILITY_ZONE));
    
    // we create an Application Load Balancer
    // elb = Elastic Load Balancer  https://docs.aws.amazon.com/cdk/api/latest/docs/aws-elasticloadbalancingv2-readme.html
    var lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {vpc, internetFacing: true });
    const listener = lb.addListener('Listener', { port: 80 });   // 443 = HTTPS
    service_mc.registerLoadBalancerTargets(
      {
        containerName: 'mc',
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