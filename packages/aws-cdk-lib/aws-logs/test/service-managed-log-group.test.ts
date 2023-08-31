import * as path from 'path';
import { Match, Template } from '../../assertions';
import * as cdk from '../../core';
import * as cxapi from '../../cx-api';
import { ServiceManagedLogGroup, RetentionDays, BaseLogGroupProps, ServiceManagedLogGroupProps } from '../lib';
import { Construct } from 'constructs';

const FUNCTION_LOGICAL_ID = 'ServiceManagedLogGroup' + 'f0360f7393ea41069d5f706d30f37fa7';

class TestLogGroup extends ServiceManagedLogGroup {
  constructor(scope: Construct, id: string, props: Omit<ServiceManagedLogGroupProps, 'tagging'>) {
    super(scope, id, {
      ...props,
      tagging: {
        service: 'logs',
        action: 'ListTags',
      },
    });
  }
}

const MATCH_DEFAULT_POLICY_STATEMENT = [Match.objectLike({}), Match.objectLike({})];
const MATCH_POLICY_NAME = Match.stringLikeRegexp(FUNCTION_LOGICAL_ID + 'ServiceRoleDefaultPolicy');
const MATCH_ROLE_REF = { Ref: Match.stringLikeRegexp(FUNCTION_LOGICAL_ID + 'ServiceRole') };
const MATCH_SERVICE_TOKEN = {
  'Fn::GetAtt': [
    Match.stringLikeRegexp(FUNCTION_LOGICAL_ID + '.{8}'),
    'Arn',
  ],
};
const matchArn = (name = 'group', includeStream = false) => ({
  'Fn::Join': [
    '',
    [
      'arn:',
      {
        Ref: 'AWS::Partition',
      },
      ':logs:',
      {
        Ref: 'AWS::Region',
      },
      ':',
      {
        Ref: 'AWS::AccountId',
      },
      `:log-group:${name}${includeStream ? ':*' : ''}`,
    ],
  ],
});
const MATCH_ARN_JOIN_STREAM = matchArn('group', true);
const MATCH_ARN_JOIN = matchArn('group', false);

describe('service managed log group', () => {
  test('log group construct', () => {
    // GIVEN
    const stack = new cdk.Stack();

    // WHEN
    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_MONTH,
    });

    // THEN
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayEquals([
          {
            Action: [
              'logs:PutRetentionPolicy',
              'logs:DeleteRetentionPolicy',
            ],
            Effect: 'Allow',
            Resource: '*',
          },
          {
            Action: [
              'logs:ListTagsForResource',
              'logs:TagResource',
              'logs:UntagResource',
            ],
            Effect: 'Allow',
            Resource: MATCH_ARN_JOIN,
          },
        ]),
        Version: '2012-10-17',
      },
      PolicyName: MATCH_POLICY_NAME,
      Roles: [MATCH_ROLE_REF],
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs18.x',
    });

    Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
      ServiceToken: MATCH_SERVICE_TOKEN,
      LogGroupName: 'group',
      RetentionInDays: 30,
    });
  });

  test('set the removalPolicy to DESTROY', () => {
    // GIVEN
    const stack = new cdk.Stack();

    // WHEN
    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // THEN
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Action: 'logs:DeleteLogGroup',
            Effect: 'Allow',
            Resource: MATCH_ARN_JOIN_STREAM,
          },
        ]),
        Version: '2012-10-17',
      },
      PolicyName: MATCH_POLICY_NAME,
      Roles: [MATCH_ROLE_REF],
    });

    Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
      ServiceToken: MATCH_SERVICE_TOKEN,
      RemovalPolicy: 'destroy',
    });
  });

  test('set the removalPolicy to RETAIN', () => {
    // GIVEN
    const stack = new cdk.Stack();

    // WHEN
    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // THEN
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: MATCH_DEFAULT_POLICY_STATEMENT, // no delete permissions
        Version: '2012-10-17',
      },
      PolicyName: MATCH_POLICY_NAME,
      Roles: [MATCH_ROLE_REF],
    });

    Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
      ServiceToken: MATCH_SERVICE_TOKEN,
      LogGroupName: 'group',
      RetentionInDays: 1,
      RemovalPolicy: 'retain',
    });
  });

  describe('multiple log group resources', () => {
    test('both removalPolicy DESTROY', () => {
      // GIVEN
      const stack = new cdk.Stack();

      // WHEN
      new TestLogGroup(stack, 'MyLogGroup1', {
        logGroupName: 'group1',
        retention: RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new TestLogGroup(stack, 'MyLogGroup2', {
        logGroupName: 'group2',
        retention: RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // THEN
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: 'logs:DeleteLogGroup',
              Effect: 'Allow',
              Resource: matchArn('group1', true),
            },
            {
              Action: 'logs:DeleteLogGroup',
              Effect: 'Allow',
              Resource: matchArn('group2', true),
            },
          ]),
          Version: '2012-10-17',
        },
        PolicyName: MATCH_POLICY_NAME,
        Roles: [MATCH_ROLE_REF],
      });

      Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
        ServiceToken: MATCH_SERVICE_TOKEN,
        LogGroupName: 'group1',
        RetentionInDays: 1,
        RemovalPolicy: 'destroy',
      });

      Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
        ServiceToken: MATCH_SERVICE_TOKEN,
        LogGroupName: 'group2',
        RetentionInDays: 1,
        RemovalPolicy: 'destroy',
      });
    });

    test('with one removalPolicy DESTROY and one removalPolicy RETAIN', () => {
      // GIVEN
      const stack = new cdk.Stack();

      // WHEN
      new TestLogGroup(stack, 'MyLogGroup1', {
        logGroupName: 'group1',
        retention: RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new TestLogGroup(stack, 'MyLogGroup2', {
        logGroupName: 'group2',
        retention: RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      // THEN
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: 'logs:DeleteLogGroup',
              Effect: 'Allow',
              Resource: matchArn('group1', true),
            },
          ]),
          Version: '2012-10-17',
        },
        PolicyName: MATCH_POLICY_NAME,
        Roles: [MATCH_ROLE_REF],
      });

      Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
        ServiceToken: MATCH_SERVICE_TOKEN,
        LogGroupName: 'group1',
        RetentionInDays: 1,
        RemovalPolicy: 'destroy',
      });

      Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
        ServiceToken: MATCH_SERVICE_TOKEN,
        LogGroupName: 'group2',
        RetentionInDays: 1,
        RemovalPolicy: 'retain',
      });
    });
  });

  test('the removalPolicy is not set', () => {
    // GIVEN
    const stack = new cdk.Stack();

    // WHEN
    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_DAY,
    });

    // THEN
    Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
      ServiceToken: MATCH_SERVICE_TOKEN,
      LogGroupName: 'group',
      RetentionInDays: 1,
      RemovalPolicy: Match.absent(),
    });
  });

  test('with RetentionPeriod set to Infinity', () => {
    const stack = new cdk.Stack();

    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.INFINITE,
    });

    Template.fromStack(stack).hasResourceProperties('Custom::ServiceManagedLogGroup', {
      RetentionInDays: Match.absent(),
    });
  });

  test('log group ARN is well formed and conforms', () => {
    const stack = new cdk.Stack();
    const group = new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_MONTH,
    });

    const logGroupArn = group.logGroupArn;
    expect(logGroupArn.indexOf('logs')).toBeGreaterThan(-1);
    expect(logGroupArn.indexOf('log-group')).toBeGreaterThan(-1);
    expect(logGroupArn.endsWith(':*')).toEqual(true);
  });

  test('retention Lambda CfnResource receives propagated tags', () => {
    const stack = new cdk.Stack();
    cdk.Tags.of(stack).add('test-key', 'test-value');
    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_MONTH,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Tags: [
        {
          Key: 'test-key',
          Value: 'test-value',
        },
      ],
    });
  });

  test('asset metadata added to log retention construct lambda function', () => {
    // GIVEN
    const stack = new cdk.Stack();
    stack.node.setContext(cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT, true);
    stack.node.setContext(cxapi.DISABLE_ASSET_STAGING_CONTEXT, true);

    const assetLocation = path.join(__dirname, '../', '/lib', '/service-managed-log-group-provider');

    // WHEN
    new TestLogGroup(stack, 'MyLogGroup', {
      logGroupName: 'group',
      retention: RetentionDays.ONE_MONTH,
    });

    // Then
    Template.fromStack(stack).hasResource('AWS::Lambda::Function', {
      Metadata: {
        'aws:asset:path': assetLocation,
        'aws:asset:is-bundled': false,
        'aws:asset:property': 'Code',
      },
    });
  });
});
