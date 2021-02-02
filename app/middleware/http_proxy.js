'use strict';

const proxy = require('http-proxy-middleware');
const c2k = require('koa2-connect');
const pathMatching = require('egg-path-matching');
const omit = require('lodash/omit');
const { tar } = require('compressing');
const nacos = require('nacos');

let client = null;
let serviceMap = {};

module.exports = (options) => {

    const nacosConfig = options['@nacos'];
    console.log(JSON.stringify(nacosConfig));

    if (!client) { //如果nacos客户端尚未初始化，则初始化并建立连接
        client = new nacos.NacosNamingClient(nacosConfig);
        client.ready().then(() => {
            Object.keys(options).some(context => {
                const proxyTableConfig = JSON.parse(JSON.stringify(options));
                let proxyOptions = proxyTableConfig[context];
                if (proxyOptions.serviceName) {
                    client.subscribe(proxyOptions.serviceName, hosts => {
                        serviceMap[proxyOptions.serviceName] = hosts;
                        console.log(`hosts:` + JSON.stringify(hosts));
                    });
                }
            });
        })
    }

    return async function httpProxy(ctx, next) {
        const proxyTable = omit(options, ['enable', 'match', 'ignore']);
        const path = ctx.request.originalUrl || ctx.request.url;
        console.log('web proxy path: ' + path + ' proxy table: ' + JSON.stringify(proxyTable));
        Object.keys(proxyTable).some(context => {
            const proxyTableConfig = JSON.parse(JSON.stringify(proxyTable));
            const match = pathMatching({ match: context });
            const isMatch = match({ path });
            if (isMatch) {
                let proxyOptions = proxyTableConfig[context];
                if (typeof proxyOptions === 'string') {
                    proxyOptions = { target: proxyOptions };
                }
                // load balance random 
                const targets = proxyOptions.target;
                let index = Math.ceil(Math.random() * targets.length);
                index = index == 0 ? 0 : index - 1;
                let target = targets[index];
                proxyOptions.target = target;
                // 如果存在@serviceName且存在配置注册服务，则获取serviceName对应的targets列表，并将target设置到proxyOptions中
                if (proxyOptions.serviceName && serviceMap[proxyOptions.serviceName] && serviceMap[proxyOptions.serviceName].length > 0) {
                    const targetList = serviceMap[proxyOptions.serviceName];
                    let tindex = Math.ceil(Math.random() * targetList.length);
                    tindex = tindex == 0 ? 0 : tindex - 1;
                    let baseTarget = targetList[tindex];
                    const baseURL = 'http://' + baseTarget.ip + ':' + baseTarget.port;
                    proxyOptions.target = baseURL;
                    console.log('baseURL: ' + baseURL);
                }
                console.log('target index :' + index + ' proxy options: ' + JSON.stringify(proxyOptions));
                c2k(proxy(context, proxyOptions))(ctx, next);
            }

            return isMatch;
        });

        await next();
    };
};