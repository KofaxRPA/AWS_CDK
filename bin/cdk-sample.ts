#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { KofaxRPAStack } from '../lib/KofaxRPA-stack';

const app = new cdk.App();
var today = new Date();
// var StackName ='RPA-'+dateAsYYYYMMDDHHNNSS(today);
var StackName ='RPA-'+leftpad(today.getHours(),2) + leftpad(today.getMinutes(),2);
new KofaxRPAStack(app, StackName);

function dateAsYYYYMMDDHHNNSS(date: Date): string {
    return date.getFullYear()
              + '' + leftpad(date.getMonth() + 1, 2)
              + '' + leftpad(date.getDate(), 2)
              + '-' + leftpad(date.getHours(), 2)
              + '' + leftpad(date.getMinutes(), 2)
              + '' + leftpad(date.getSeconds(), 2);
  }
  
  function leftpad(val: number, resultLength = 2, leftpadChar = '0'): string {
    return (String(leftpadChar).repeat(resultLength)
          + String(val)).slice(String(val).length);
  }