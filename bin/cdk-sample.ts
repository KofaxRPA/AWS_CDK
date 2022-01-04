#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { KofaxRPAStack } from '../lib/cdk-sample-stack';

const app = new cdk.App();
new KofaxRPAStack(app, 'CdkSampleStack');