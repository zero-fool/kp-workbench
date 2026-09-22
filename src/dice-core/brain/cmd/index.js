'use strict';
/* brain/cmd：指令①核心组模块装配（r/rh/ra/rd/st/help）。require 即完成注册。 */

require('./r');
require('./rh');
require('./ra');
require('./rd');
require('./st');
require('./help');
require('./jrrp');
require('./sign');
require('./drew');
require('./custom');
require('./log');
require('./admin');
require('./set');

module.exports = { core: ['r', 'rh', 'ra', 'rd', 'st', 'help'], fun: ['jrrp', 'sign', 'drew'], admin: ['custom', 'log', 'admin', 'set'] };