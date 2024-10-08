import t, { almost, is, not, ok, same, throws } from 'tst'
import compileZ from '../../src/compile.js'
import { compileWat } from '../util.js'

t('scope: early returns', t => {
  let wat = compileZ(`x(a)=(a ?/-a; 123), y(a)=(a?/12;13.4)`)
  let mod = compileWat(wat)
  let { memory, x, y, z } = mod.instance.exports
  is(x(0), 123);
  is(x(1), -1);
  is(y(0), 13.4);
  is(y(1), 12);

  wat = compileZ(`z(a)=(a ? /11 : /12.1; /13)`)
  mod = compileWat(wat);
  z = mod.instance.exports.z
  is(z(0), 12.1);
  is(z(1), 11);

  wat = compileZ(`z(a)=(/ a ? 11 : 12.1; /13)`)
  mod = compileWat(wat);
  z = mod.instance.exports.z
  is(z(0), 12.1);
  is(z(1), 11);

  wat = compileZ(`y(a,b)=(a ? /b; a,b)`)
  mod = compileWat(wat)
  y = mod.instance.exports.y
  is(y(1), [NaN, NaN])
  is(y(1, 2), [2, NaN])
  is(y(0, 1), [0, 1])
})

t.todo('scope: break/continue', t => {

})
