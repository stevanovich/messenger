var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// node_modules/@noble/hashes/esm/crypto.js
var crypto = typeof globalThis === "object" && "crypto" in globalThis ? globalThis.crypto : void 0;

// node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new Error("Hash should be wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad2 = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad2);
    pad2 += a.length;
  }
  return res;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto && typeof crypto.randomBytes === "function") {
    return Uint8Array.from(crypto.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/@noble/curves/esm/utils.js
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function bitLen(n) {
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// node_modules/@li0ard/gostcurves/dist/const.js
var ID_GOSTR3410_2001_PARAM_SET_CC = {
  p: 0xc0000000000000000000000000000000000000000000000000000000000003c7n,
  n: 0x5fffffffffffffffffffffffffffffff606117a2f4bde428b7458a54b6e87b85n,
  a: 0xc0000000000000000000000000000000000000000000000000000000000003c4n,
  b: 0x2d06b4265ebc749ff7d0f1f1f88232e81632e9088fd44b7787d5e407e955080cn,
  Gx: 2n,
  Gy: 0xa20e034bf8813ef5c18d01105e726a17eb248b264ae9706f440bedc8ccb6b22cn,
  h: 1n,
  length: 32,
  oids: ["1.2.643.2.9.1.8.1"]
};
var ID_GOSTR3410_2001_TEST_PARAM_SET = {
  p: 0x8000000000000000000000000000000000000000000000000000000000000431n,
  n: 0x8000000000000000000000000000000150fe8a1892976154c59cfc193accf5b3n,
  a: 7n,
  b: 0x5fbff498aa938ce739b8e022fbafef40563f6e6a3472fc2a514c0ce9dae23b7en,
  Gx: 2n,
  Gy: 0x08e2a8a0e65147d4bd6316030e16d19c85c97f0a9ca267122b96abbcea7e8fc8n,
  h: 1n,
  length: 32,
  oids: ["1.2.643.2.2.35.0"]
};
var ID_GOSTR3410_2012_256_PARAM_SET_A = {
  p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd97n,
  n: 0x400000000000000000000000000000000fd8cddfc87b6635c115af556c360c67n,
  a: 0xc2173f1513981673af4892c23035a27ce25e2013bf95aa33b22c656f277e7335n,
  b: 0x295f9bae7428ed9ccc20e7c359a9d41a22fccd9108e17bf7ba9337a6f8ae9513n,
  Gx: 0x91e38443a5e82c0d880923425712b2bb658b9196932e02c78b2582fe742daa28n,
  Gy: 0x32879423ab1a0375895786c4bb46e9565fde0b5344766740af268adb32322e5cn,
  h: 4n,
  e: 1n,
  d: 0x0605f6b7c183fa81578bc39cfad518132b9df62897009af7e522c32d6dc7bffbn,
  length: 32,
  st: [0x7e7e82520f9f015faa1d0f18c14ab9fb35188275da3fd94206b74f34a48e0ecdn, 0x0100fe73f595ff158e974b44d478d9588744fe5c192ac47ea63075dce7a14aaan],
  oids: ["1.2.643.7.1.2.1.1.1"]
};
var ID_GOSTR3410_2012_256_PARAM_SET_B = {
  p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd97n,
  n: 0xffffffffffffffffffffffffffffffff6c611070995ad10045841b09b761b893n,
  a: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd94n,
  b: 0xa6n,
  Gx: 1n,
  Gy: 0x8d91e471e0989cda27df505a453f2b7635294f2ddf23e3b122acc99c9e9f1e14n,
  h: 1n,
  length: 32,
  oids: ["1.2.643.7.1.2.1.1.2", "1.2.643.2.2.35.1", "1.2.643.2.2.36.0"]
};
var ID_GOSTR3410_2012_256_PARAM_SET_C = {
  p: 0x8000000000000000000000000000000000000000000000000000000000000c99n,
  n: 0x800000000000000000000000000000015f700cfff1a624e5e497161bcc8a198fn,
  a: 0x8000000000000000000000000000000000000000000000000000000000000c96n,
  b: 0x3e1af419a269a5f866a7d3c25c3df80ae979259373ff2b182f49d4ce7e1bbc8bn,
  Gx: 1n,
  Gy: 0x3fa8124359f96680b83d1c3eb2c070e5c545c9858d03ecfb744bf8d717717efcn,
  h: 1n,
  length: 32,
  oids: ["1.2.643.7.1.2.1.1.3", "1.2.643.2.2.35.2"]
};
var ID_GOSTR3410_2012_256_PARAM_SET_D = {
  p: 0x9b9f605f5a858107ab1ec85e6b41c8aacf846e86789051d37998f7b9022d759bn,
  n: 0x9b9f605f5a858107ab1ec85e6b41c8aa582ca3511eddfb74f02f3a6598980bb9n,
  a: 0x9b9f605f5a858107ab1ec85e6b41c8aacf846e86789051d37998f7b9022d7598n,
  b: 0x0805an,
  Gx: 0n,
  Gy: 0x41ece55743711a8c3cbf3783cd08c0ee4d4dc440d4641a8f366e550dfdb3bb67n,
  h: 1n,
  length: 32,
  oids: ["1.2.643.7.1.2.1.1.4", "1.2.643.2.2.35.3", "1.2.643.2.2.36.1"]
};
var ID_GOSTR3410_2012_512_TEST_PARAM_SET = {
  p: 0x4531acd1fe0023c7550d267b6b2fee80922b14b2ffb90f04d4eb7c09b5d2d15df1d852741af4704a0458047e80e4546d35b8336fac224dd81664bbf528be6373n,
  n: 0x4531acd1fe0023c7550d267b6b2fee80922b14b2ffb90f04d4eb7c09b5d2d15da82f2d7ecb1dbac719905c5eecc423f1d86e25edbe23c595d644aaf187e6e6dfn,
  a: 7n,
  b: 0x1cff0806a31116da29d8cfa54e57eb748bc5f377e49400fdd788b649eca1ac4361834013b2ad7322480a89ca58e0cf74bc9e540c2add6897fad0a3084f302adcn,
  Gx: 0x24d19cc64572ee30f396bf6ebbfd7a6c5213b3b3d7057cc825f91093a68cd762fd60611262cd838dc6b60aa7eee804e28bc849977fac33b4b530f1b120248a9an,
  Gy: 0x2bb312a43bd2ce6e0d020613c857acddcfbf061e91e5f2c3f32447c259f39b2c83ab156d77f1496bf7eb3351e1ee4e43dc1a18b91b24640b6dbb92cb1add371en,
  h: 1n,
  length: 64,
  oids: ["1.2.643.7.1.2.1.2.0"]
};
var ID_GOSTR3410_2012_512_PARAM_SET_A = {
  p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc7n,
  n: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff27e69532f48d89116ff22b8d4e0560609b4b38abfad2b85dcacdb1411f10b275n,
  a: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc4n,
  b: 0xe8c2505dedfc86ddc1bd0b2b6667f1da34b82574761cb0e879bd081cfd0b6265ee3cb090f30d27614cb4574010da90dd862ef9d4ebee4761503190785a71c760n,
  Gx: 3n,
  Gy: 0x7503cfe87a836ae3a61b8816e25450e6ce5e1c93acf1abc1778064fdcbefa921df1626be4fd036e93d75e6a50e3a41e98028fe5fc235f5b889a589cb5215f2a4n,
  h: 1n,
  length: 64,
  oids: ["1.2.643.7.1.2.1.2.1"]
};
var ID_GOSTR3410_2012_512_PARAM_SET_B = {
  p: 0x8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006fn,
  n: 0x800000000000000000000000000000000000000000000000000000000000000149a1ec142565a545acfdb77bd9d40cfa8b996712101bea0ec6346c54374f25bdn,
  a: 0x8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006cn,
  b: 0x687d1b459dc841457e3e06cf6f5e2517b97c7d614af138bcbf85dc806c4b289f3e965d2db1416d217f8b276fad1ab69c50f78bee1fa3106efb8ccbc7c5140116n,
  Gx: 2n,
  Gy: 0x1a8f7eda389b094c2c071e3647a8940f3c123b697578c213be6dd9e6c8ec7335dcb228fd1edf4a39152cbcaaf8c0398828041055f94ceeec7e21340780fe41bdn,
  h: 1n,
  length: 64,
  oids: ["1.2.643.7.1.2.1.2.2"]
};
var ID_GOSTR3410_2012_512_PARAM_SET_C = {
  p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdc7n,
  n: 0x3fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc98cdba46506ab004c33a9ff5147502cc8eda9e7a769a12694623cef47f023edn,
  a: 0xdc9203e514a721875485a529d2c722fb187bc8980eb866644de41c68e143064546e861c0e2c9edd92ade71f46fcf50ff2ad97f951fda9f2a2eb6546f39689bd3n,
  b: 0xb4c4ee28cebc6c2c8ac12952cf37f16ac7efb6a9f69f4b57ffda2e4f0de5ade038cbc2fff719d2c18de0284b8bfef3b52b8cc7a5f5bf0a3c8d2319a5312557e1n,
  Gx: 0xe2e31edfc23de7bdebe241ce593ef5de2295b7a9cbaef021d385f7074cea043aa27272a7ae602bf2a7b9033db9ed3610c6fb85487eae97aac5bc7928c1950148n,
  Gy: 0xf5ce40d95b5eb899abbccff5911cb8577939804d6527378b8c108c3d2090ff9be18e2d33e3021ed2ef32d85822423b6304f726aa854bae07d0396e9a9addc40fn,
  h: 4n,
  e: 1n,
  d: 0x9e4f5d8c017d8d9f13a5cf3cdf5bfe4dab402d54198e31ebde28a0621050439ca6b39e0a515c06b304e2ce43e79e369e91a0cfc2bc2a22b4ca302dbb33ee7550n,
  length: 64,
  st: [0x186c289cffa09c983b168c30c829006c952ff4aaf99c73850875d7e77bebef18d653187d6ba8fe533ec74c6f061872585b97cc0f50f57752cd73f4913304621en, 0x9a628f975594ecefd89ba28a2539ffb79c8ab238aeed0851fa5c1abb02b80b44c6734501b83a011dd625cd0b5145091a6d9acd4b1f5c5b1e21b2b249ddfd1271n],
  oids: ["1.2.643.7.1.2.1.2.3"]
};

// node_modules/@noble/curves/esm/abstract/modular.js
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
  if (!Fp.eql(Fp.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp, n) {
  const p1div4 = (Fp.ORDER + _1n2) / _4n;
  const root = Fp.pow(n, p1div4);
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const p5div8 = (Fp.ORDER - _5n) / _8n;
  const n2 = Fp.mul(n, _2n);
  const v = Fp.pow(n2, p5div8);
  const nv = Fp.mul(n, v);
  const i = Fp.mul(Fp.mul(nv, _2n), v);
  const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
  assertIsSquare(Fp, root, n);
  return root;
}
function sqrt9mod16(P2) {
  const Fp_ = Field(P2);
  const tn = tonelliShanks(P2);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P2 + _7n) / _16n;
  return (Fp, n) => {
    let tv1 = Fp.pow(n, c4);
    let tv2 = Fp.mul(tv1, c1);
    const tv3 = Fp.mul(tv1, c2);
    const tv4 = Fp.mul(tv1, c3);
    const e1 = Fp.eql(Fp.sqr(tv2), n);
    const e2 = Fp.eql(Fp.sqr(tv3), n);
    tv1 = Fp.cmov(tv1, tv2, e1);
    tv2 = Fp.cmov(tv4, tv3, e2);
    const e3 = Fp.eql(Fp.sqr(tv2), n);
    const root = Fp.cmov(tv1, tv2, e3);
    assertIsSquare(Fp, root, n);
    return root;
  };
}
function tonelliShanks(P2) {
  if (P2 < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P2 - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P2);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    if (Fp.is0(n))
      return n;
    if (FpLegendre(Fp, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp.mul(Fp.ONE, cc);
    let t = Fp.pow(n, Q);
    let R = Fp.pow(n, Q1div2);
    while (!Fp.eql(t, Fp.ONE)) {
      if (Fp.is0(t))
        return Fp.ZERO;
      let i = 1;
      let t_tmp = Fp.sqr(t);
      while (!Fp.eql(t_tmp, Fp.ONE)) {
        i++;
        t_tmp = Fp.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp.pow(c, exponent);
      M = i;
      c = Fp.sqr(b);
      t = Fp.mul(t, c);
      R = Fp.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P2) {
  if (P2 % _4n === _3n)
    return sqrt3mod4;
  if (P2 % _8n === _5n)
    return sqrt5mod8;
  if (P2 % _16n === _9n)
    return sqrt9mod16(P2);
  return tonelliShanks(P2);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp.ONE;
  if (power === _1n2)
    return num;
  let p = Fp.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp.mul(p, d);
    d = Fp.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp.mul(acc, num);
  }, Fp.ONE);
  const invertedAcc = Fp.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp.is0(num))
      return acc;
    inverted[i] = Fp.mul(acc, inverted[i]);
    return Fp.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  const p1mod2 = (Fp.ORDER - _1n2) / _2n;
  const powered = Fp.pow(n, p1mod2);
  const yes = Fp.eql(powered, Fp.ONE);
  const zero = Fp.eql(powered, Fp.ZERO);
  const no = Fp.eql(powered, Fp.neg(Fp.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLenOrOpts, isLE = false, opts = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = void 0;
  let _sqrt = void 0;
  let modFromBytes = false;
  let allowedLengths = void 0;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    allowedLengths,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    // is valid and invertible
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (lst) => FpInvertBatch(f, lst),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}

// node_modules/@noble/hashes/esm/hmac.js
var HMAC = class extends Hash {
  constructor(hash, _key) {
    super();
    this.finished = false;
    this.destroyed = false;
    ahash(hash);
    const key = toBytes(_key);
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad2 = new Uint8Array(blockLen);
    pad2.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad2.length; i++)
      pad2[i] ^= 54;
    this.iHash.update(pad2);
    this.oHash = hash.create();
    for (let i = 0; i < pad2.length; i++)
      pad2[i] ^= 54 ^ 92;
    this.oHash.update(pad2);
    clean(pad2);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    abytes(out, this.outputLen);
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
hmac.create = (hash, key) => new HMAC(hash, key);

// node_modules/@noble/curves/esm/abstract/curve.js
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    if (!field.isValid(s))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P2) {
  return pointWindowSizes.get(P2) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  // Parametrized with a given Point class (not individual point)
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  // non-const time multiplication ladder
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point Point instance
   * @param W window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0; window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1; i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  /**
   * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
   * @param acc accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(P2, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P2, W);
    pointPrecomputes.delete(P2);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n3 || k2 > _0n3) {
    if (k1 & _1n3)
      p1 = p1.add(acc);
    if (k2 & _1n3)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n3;
    k2 >>= _1n3;
  }
  return { p1, p2 };
}
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < slength; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}

// node_modules/@noble/curves/esm/abstract/weierstrass.js
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed, k=" + k);
  }
  return { k1neg, k1, k2neg, k2 };
}
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function _normFnElement(Fn, key) {
  const { BYTES: expected } = Fn;
  let num;
  if (typeof key === "bigint") {
    num = key;
  } else {
    let bytes = ensureBytes("private key", key);
    try {
      num = Fn.fromBytes(bytes);
    } catch (error) {
      throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
    }
  }
  if (!Fn.isValidNot0(num))
    throw new Error("invalid private key: out of range [1..N-1]");
  return num;
}
function weierstrassN(params, extraOpts = {}) {
  const validated = _createCurveFields("weierstrass", params, extraOpts);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  _validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    wrapPrivateKey: "boolean"
  });
  const { endo } = extraOpts;
  if (endo) {
    if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    _abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes(pprefix(hasEvenY), bx);
    } else {
      return concatBytes(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    _abytes2(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const isYOdd = Fp.isOdd(y);
      const isHeadOdd = (head & 1) === 1;
      if (isHeadOdd !== isYOdd)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes || pointToBytes;
  const decodePoint = extraOpts.fromBytes || pointFromBytes;
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n2);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ProjectivePoint expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    if (Fp.eql(Z, Fp.ONE))
      return { x: X, y: Y };
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? Fp.ONE : Fp.inv(Z);
    const x = Fp.mul(X, iz);
    const y = Fp.mul(Y, iz);
    const zz = Fp.mul(Z, iz);
    if (is0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (!Fp.eql(zz, Fp.ONE))
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    if (p.is0()) {
      if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x, y } = p.toAffine();
    if (!Fp.isValid(x) || !Fp.isValid(y))
      throw new Error("bad point: x or y not field elements");
    if (!isValidXY(x, y))
      throw new Error("bad point: equation left != right");
    if (!p.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return true;
  });
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }
  class Point {
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P2 = Point.fromAffine(decodePoint(_abytes2(bytes, void 0, "point")));
      P2.assertValidity();
      return P2;
    }
    static fromHex(hex) {
      return Point.fromBytes(ensureBytes("pointHex", hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     *
     * @param windowSize
     * @param isLazy true will defer table computation until the first multiplication
     * @returns
     */
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      assertValidMemo(this);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE;
      const b3 = Fp.mul(b, _3n2);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      const a = CURVE.a;
      const b3 = Fp.mul(CURVE.b, _3n2);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn.isValidNot0(scalar))
        throw new Error("invalid scalar: out of range");
      let point, fake;
      const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul(k1);
        const { p: k2p, f: k2f } = mul(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ(Point, [point, fake])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(sc) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      if (!Fn.isValid(sc))
        throw new Error("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
        return p;
      if (wnaf.hasCache(this))
        return this.multiply(sc);
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
        const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
        return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
      } else {
        return wnaf.unsafe(p, sc);
      }
    }
    multiplyAndAddUnsafe(Q, a, b) {
      const sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
      return sum.is0() ? void 0 : sum;
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    toBytes(isCompressed = true) {
      _abool2(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get px() {
      return this.X;
    }
    get py() {
      return this.X;
    }
    get pz() {
      return this.Z;
    }
    toRawBytes(isCompressed = true) {
      return this.toBytes(isCompressed);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    static normalizeZ(points) {
      return normalizeZ(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn, points, scalars);
    }
    static fromPrivateKey(privateKey) {
      return Point.BASE.multiply(_normFnElement(Fn, privateKey));
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
  Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
  Point.Fp = Fp;
  Point.Fn = Fn;
  const bits = Fn.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  Point.BASE.precompute(8);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    signature: 2 * Fn.BYTES
  };
}

// node_modules/@li0ard/gost341194/dist/utils.js
var xor = (a, b) => {
  let mlen = Math.min(a.length, b.length);
  let result = new Uint8Array(mlen);
  for (let i = 0; i < mlen; i++)
    result[i] = a[i] ^ b[i];
  return result.slice();
};
function concatBytes2(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad2 = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad2);
    pad2 += a.length;
  }
  return res;
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? 0n : BigInt("0x" + hex);
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex2(bytes));
}
var asciis2 = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase162(ch) {
  if (ch >= asciis2._0 && ch <= asciis2._9)
    return ch - asciis2._0;
  if (ch >= asciis2.A && ch <= asciis2.F)
    return ch - (asciis2.A - 10);
  if (ch >= asciis2.a && ch <= asciis2.f)
    return ch - (asciis2.a - 10);
  return;
}
function hexToBytes2(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
var hexes2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex2(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++)
    hex += hexes2[bytes[i]];
  return hex;
}
function numberToBytesBE2(n, len) {
  let num = n.toString(16).padStart(len * 2, "0");
  while (num.length % 2 != 0)
    num = "0" + num;
  return hexToBytes2(num);
}

// node_modules/@li0ard/gost3413/dist/utils.js
var KEYSIZE = 32;
function concatBytes3(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad2 = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad2);
    pad2 += a.length;
  }
  return res;
}
var hexes3 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

// node_modules/@li0ard/gost3413/dist/index.js
var ecb_encrypt = (encrypter, blockSize, data) => {
  if (data.length == 0 || data.length % blockSize !== 0)
    throw new Error("Data not aligned");
  const result = new Uint8Array(data.length);
  let offset = 0;
  for (let i = 0; i < data.length; i += blockSize) {
    const chunk = data.slice(i, i + blockSize);
    const encrypted = encrypter(chunk);
    result.set(encrypted, offset);
    offset += encrypted.length;
  }
  return result.slice();
};

// node_modules/@li0ard/magma/dist/const.js
var ID_TC26_GOST_28147_PARAM_Z = [
  [12, 4, 6, 2, 10, 5, 11, 9, 14, 8, 13, 7, 0, 3, 15, 1],
  [6, 8, 2, 3, 9, 10, 5, 12, 1, 14, 4, 7, 11, 13, 0, 15],
  [11, 3, 5, 8, 2, 15, 10, 13, 14, 1, 7, 4, 12, 9, 6, 0],
  [12, 8, 2, 1, 13, 4, 15, 6, 7, 0, 10, 5, 3, 14, 9, 11],
  [7, 15, 5, 10, 8, 1, 6, 13, 0, 9, 3, 14, 11, 4, 2, 12],
  [5, 13, 15, 6, 9, 2, 12, 10, 11, 7, 8, 1, 4, 3, 14, 0],
  [8, 14, 2, 5, 6, 9, 1, 12, 15, 4, 11, 0, 13, 10, 3, 7],
  [1, 7, 14, 13, 0, 5, 8, 3, 4, 15, 10, 6, 9, 12, 11, 2]
];
var ID_GOST_28147_89_CRYPTO_PRO_A_PARAM_SET = [
  [9, 6, 3, 2, 8, 11, 1, 7, 10, 4, 14, 15, 12, 0, 13, 5],
  [3, 7, 14, 9, 8, 10, 15, 0, 5, 2, 6, 12, 11, 4, 13, 1],
  [14, 4, 6, 2, 11, 3, 13, 8, 12, 15, 5, 10, 0, 7, 1, 9],
  [14, 7, 10, 12, 13, 1, 3, 9, 0, 2, 11, 4, 15, 8, 5, 6],
  [11, 5, 1, 9, 8, 13, 15, 0, 14, 4, 2, 3, 12, 7, 10, 6],
  [3, 10, 13, 12, 1, 2, 0, 11, 7, 5, 9, 4, 8, 15, 14, 6],
  [1, 13, 2, 9, 7, 10, 6, 0, 8, 12, 4, 5, 15, 3, 11, 14],
  [11, 10, 15, 5, 0, 12, 14, 8, 6, 2, 3, 9, 1, 7, 13, 4]
];
var ID_GOST_28147_89_CRYPTO_PRO_B_PARAM_SET = [
  [8, 4, 11, 1, 3, 5, 0, 9, 2, 14, 10, 12, 13, 6, 7, 15],
  [0, 1, 2, 10, 4, 13, 5, 12, 9, 7, 3, 15, 11, 8, 6, 14],
  [14, 12, 0, 10, 9, 2, 13, 11, 7, 5, 8, 15, 3, 6, 1, 4],
  [7, 5, 0, 13, 11, 6, 1, 2, 3, 10, 12, 15, 4, 14, 9, 8],
  [2, 7, 12, 15, 9, 5, 10, 11, 1, 4, 0, 13, 6, 8, 14, 3],
  [8, 3, 2, 6, 4, 13, 14, 11, 12, 1, 7, 15, 10, 0, 9, 5],
  [5, 2, 10, 11, 9, 1, 12, 3, 7, 4, 13, 0, 6, 15, 8, 14],
  [0, 4, 11, 14, 8, 3, 7, 1, 10, 2, 9, 6, 15, 13, 5, 12]
];
var ID_GOST_28147_89_CRYPTO_PRO_C_PARAM_SET = [
  [1, 11, 12, 2, 9, 13, 0, 15, 4, 5, 8, 14, 10, 7, 6, 3],
  [0, 1, 7, 13, 11, 4, 5, 2, 8, 14, 15, 12, 9, 10, 6, 3],
  [8, 2, 5, 0, 4, 9, 15, 10, 3, 7, 12, 13, 6, 14, 1, 11],
  [3, 6, 0, 1, 5, 13, 10, 8, 11, 2, 9, 7, 14, 15, 12, 4],
  [8, 13, 11, 0, 4, 5, 1, 2, 9, 3, 12, 14, 6, 15, 10, 7],
  [12, 9, 11, 1, 8, 14, 2, 4, 7, 3, 6, 5, 10, 0, 15, 13],
  [10, 9, 6, 8, 13, 14, 2, 0, 15, 3, 5, 11, 4, 1, 12, 7],
  [7, 4, 0, 5, 10, 2, 15, 14, 12, 6, 1, 11, 13, 9, 3, 8]
];
var ID_GOST_28147_89_CRYPTO_PRO_D_PARAM_SET = [
  [15, 12, 2, 10, 6, 4, 5, 0, 7, 9, 14, 13, 1, 11, 8, 3],
  [11, 6, 3, 4, 12, 15, 14, 2, 7, 13, 8, 0, 5, 10, 9, 1],
  [1, 12, 11, 0, 15, 14, 6, 5, 10, 13, 4, 8, 9, 3, 7, 2],
  [1, 5, 14, 12, 10, 7, 0, 13, 6, 2, 11, 4, 9, 3, 15, 8],
  [0, 12, 8, 9, 13, 2, 10, 11, 7, 3, 6, 5, 4, 14, 15, 1],
  [8, 0, 15, 3, 2, 5, 14, 11, 1, 10, 4, 7, 12, 9, 13, 6],
  [3, 0, 6, 15, 1, 14, 9, 2, 13, 8, 12, 4, 11, 10, 5, 7],
  [1, 10, 6, 8, 15, 11, 0, 4, 12, 3, 5, 9, 7, 13, 2, 14]
];
var DSSZZI_UA_DKE_1 = [
  [10, 9, 13, 6, 14, 11, 4, 5, 15, 1, 3, 12, 7, 0, 8, 2],
  [8, 0, 12, 4, 9, 6, 7, 11, 2, 3, 1, 15, 5, 14, 10, 13],
  [15, 6, 5, 8, 14, 11, 10, 4, 12, 0, 3, 7, 2, 9, 1, 13],
  [3, 8, 13, 9, 6, 11, 15, 0, 2, 5, 12, 10, 4, 14, 1, 7],
  [15, 8, 14, 9, 7, 2, 0, 13, 12, 6, 1, 5, 11, 4, 3, 10],
  [2, 8, 9, 7, 5, 15, 0, 11, 12, 1, 13, 14, 10, 3, 6, 4],
  [3, 8, 11, 5, 6, 4, 14, 10, 2, 12, 1, 7, 9, 15, 13, 0],
  [1, 2, 3, 14, 6, 13, 11, 8, 15, 10, 12, 5, 7, 9, 0, 4]
];
var DSSZZI_UA_DKE_2 = [
  [14, 9, 3, 7, 15, 4, 12, 11, 6, 10, 13, 1, 0, 5, 8, 2],
  [10, 13, 12, 7, 6, 14, 8, 1, 15, 3, 11, 4, 0, 9, 5, 2],
  [4, 11, 1, 15, 9, 2, 14, 12, 6, 10, 8, 7, 3, 5, 0, 13],
  [4, 5, 1, 12, 7, 14, 9, 2, 10, 15, 11, 13, 0, 8, 6, 3],
  [12, 11, 3, 9, 15, 0, 4, 5, 7, 2, 14, 13, 1, 10, 8, 6],
  [8, 7, 3, 10, 9, 6, 14, 5, 13, 0, 4, 12, 1, 2, 15, 11],
  [15, 0, 14, 6, 8, 13, 5, 9, 10, 3, 1, 12, 4, 11, 7, 2],
  [4, 3, 14, 13, 5, 0, 2, 11, 1, 10, 7, 6, 9, 15, 8, 12]
];
var DSSZZI_UA_DKE_3 = [
  [13, 9, 1, 14, 7, 2, 12, 5, 4, 11, 6, 15, 3, 8, 10, 0],
  [7, 8, 6, 11, 0, 3, 4, 13, 9, 5, 15, 14, 10, 12, 2, 1],
  [10, 5, 3, 12, 9, 8, 13, 6, 4, 15, 14, 0, 2, 11, 1, 7],
  [11, 10, 12, 1, 5, 6, 9, 14, 2, 13, 15, 7, 0, 4, 3, 8],
  [5, 11, 3, 0, 15, 9, 14, 4, 1, 12, 8, 6, 2, 10, 7, 13],
  [4, 3, 11, 13, 1, 15, 8, 2, 7, 14, 12, 9, 10, 0, 6, 5],
  [3, 7, 8, 11, 1, 14, 5, 0, 13, 4, 12, 10, 2, 9, 15, 6],
  [6, 13, 12, 10, 11, 7, 9, 3, 15, 14, 1, 2, 0, 8, 4, 5]
];
var DSSZZI_UA_DKE_4 = [
  [9, 12, 3, 13, 7, 6, 14, 1, 10, 2, 0, 4, 8, 15, 5, 11],
  [10, 5, 11, 14, 7, 6, 0, 12, 2, 8, 15, 4, 13, 3, 9, 1],
  [4, 12, 3, 0, 13, 2, 14, 11, 7, 15, 5, 9, 1, 8, 10, 6],
  [3, 9, 4, 5, 14, 7, 8, 6, 13, 0, 2, 15, 11, 12, 10, 1],
  [2, 9, 12, 15, 13, 11, 4, 1, 7, 5, 3, 14, 6, 8, 10, 0],
  [14, 5, 13, 11, 1, 9, 4, 2, 15, 8, 7, 0, 3, 12, 10, 6],
  [14, 6, 5, 10, 9, 13, 4, 8, 11, 12, 0, 3, 7, 1, 15, 2],
  [1, 9, 12, 11, 7, 6, 8, 3, 2, 15, 14, 0, 5, 10, 4, 13]
];
var DSSZZI_UA_DKE_5 = [
  [3, 4, 13, 8, 12, 7, 10, 2, 0, 14, 9, 15, 11, 1, 5, 6],
  [12, 7, 6, 9, 3, 8, 11, 5, 15, 10, 0, 13, 4, 2, 1, 14],
  [14, 4, 8, 7, 11, 3, 10, 12, 1, 2, 6, 9, 13, 15, 0, 5],
  [3, 9, 6, 13, 8, 15, 10, 2, 7, 14, 12, 0, 11, 4, 1, 5],
  [5, 12, 10, 7, 2, 1, 15, 13, 14, 3, 11, 4, 0, 8, 9, 6],
  [1, 8, 11, 14, 7, 4, 10, 0, 12, 3, 5, 13, 9, 15, 6, 2],
  [9, 11, 10, 13, 5, 14, 2, 3, 0, 6, 4, 12, 15, 1, 7, 8],
  [14, 9, 1, 8, 5, 15, 11, 0, 6, 2, 12, 7, 10, 4, 13, 3]
];
var DSSZZI_UA_DKE_6 = [
  [15, 12, 9, 6, 14, 2, 1, 11, 0, 13, 4, 10, 7, 8, 3, 5],
  [14, 12, 5, 0, 7, 4, 10, 3, 2, 6, 1, 13, 9, 11, 15, 8],
  [5, 6, 13, 9, 11, 14, 10, 3, 15, 2, 8, 1, 4, 0, 7, 12],
  [1, 15, 7, 4, 2, 14, 12, 3, 6, 11, 9, 8, 0, 5, 10, 13],
  [15, 9, 14, 6, 13, 1, 5, 8, 4, 2, 3, 12, 10, 11, 0, 7],
  [11, 0, 13, 7, 12, 14, 1, 4, 2, 3, 6, 8, 10, 5, 15, 9],
  [7, 14, 15, 8, 13, 0, 11, 3, 10, 1, 4, 2, 9, 12, 6, 5],
  [1, 5, 14, 11, 2, 12, 3, 8, 10, 0, 9, 7, 15, 6, 4, 13]
];
var DSSZZI_UA_DKE_7 = [
  [15, 13, 10, 5, 12, 0, 1, 6, 9, 2, 14, 7, 3, 11, 4, 8],
  [2, 5, 10, 0, 6, 9, 1, 15, 13, 4, 7, 14, 11, 3, 8, 12],
  [3, 14, 4, 11, 5, 9, 1, 2, 15, 6, 8, 13, 7, 0, 10, 12],
  [4, 10, 11, 9, 15, 2, 14, 5, 13, 1, 3, 6, 0, 7, 12, 8],
  [15, 6, 5, 8, 9, 7, 12, 11, 0, 10, 3, 1, 2, 4, 13, 14],
  [12, 11, 15, 4, 5, 1, 14, 9, 0, 8, 13, 2, 10, 7, 3, 6],
  [13, 2, 4, 8, 11, 12, 1, 3, 10, 5, 9, 14, 7, 15, 0, 6],
  [1, 5, 0, 15, 6, 10, 3, 14, 7, 2, 12, 13, 11, 8, 9, 4]
];
var DSSZZI_UA_DKE_8 = [
  [14, 4, 11, 2, 8, 7, 5, 12, 9, 13, 0, 3, 1, 15, 6, 10],
  [3, 14, 12, 10, 6, 2, 13, 1, 9, 8, 7, 4, 0, 15, 5, 11],
  [5, 2, 8, 7, 1, 15, 14, 6, 4, 13, 11, 0, 10, 3, 12, 9],
  [12, 10, 7, 13, 14, 3, 0, 2, 9, 5, 1, 6, 11, 4, 15, 8],
  [6, 3, 15, 7, 0, 9, 10, 8, 11, 12, 4, 1, 5, 2, 13, 14],
  [6, 13, 15, 1, 5, 3, 8, 0, 11, 10, 14, 4, 9, 12, 2, 7],
  [2, 15, 12, 5, 11, 1, 3, 14, 0, 6, 13, 10, 7, 9, 4, 8],
  [3, 0, 5, 12, 8, 15, 13, 14, 11, 6, 2, 9, 7, 1, 4, 10]
];
var DSSZZI_UA_DKE_9 = [
  [9, 0, 11, 12, 2, 4, 3, 15, 13, 6, 14, 1, 10, 7, 5, 8],
  [3, 5, 0, 15, 8, 7, 14, 12, 13, 10, 1, 6, 11, 2, 4, 9],
  [8, 4, 5, 10, 14, 11, 13, 6, 12, 15, 7, 9, 3, 1, 2, 0],
  [5, 4, 15, 0, 12, 11, 10, 9, 1, 14, 8, 6, 3, 2, 13, 7],
  [7, 12, 3, 0, 6, 8, 14, 11, 1, 15, 13, 10, 9, 5, 2, 4],
  [7, 4, 3, 11, 6, 10, 8, 1, 9, 12, 14, 13, 0, 15, 2, 5],
  [7, 14, 9, 15, 1, 4, 8, 3, 11, 13, 0, 2, 6, 10, 5, 12],
  [14, 2, 8, 15, 3, 0, 7, 12, 11, 13, 1, 5, 6, 4, 9, 10]
];
var DSSZZI_UA_DKE_10 = [
  [8, 4, 6, 9, 11, 12, 1, 2, 3, 7, 14, 0, 13, 10, 15, 5],
  [7, 13, 1, 8, 10, 14, 4, 15, 9, 0, 6, 3, 2, 12, 11, 5],
  [12, 8, 13, 1, 10, 2, 9, 6, 3, 4, 14, 7, 5, 15, 0, 11],
  [2, 11, 3, 4, 12, 7, 9, 13, 15, 8, 5, 0, 1, 14, 10, 6],
  [8, 3, 13, 10, 14, 15, 5, 1, 4, 7, 11, 12, 2, 0, 6, 9],
  [4, 12, 9, 11, 14, 10, 7, 6, 3, 5, 0, 15, 1, 2, 8, 13],
  [5, 8, 14, 7, 3, 0, 1, 13, 10, 6, 9, 2, 15, 11, 12, 4],
  [10, 3, 5, 9, 0, 13, 7, 8, 12, 4, 1, 6, 11, 15, 2, 14]
];
var ID_GOST_28147_89_TEST_PARAM_SET = [
  [4, 2, 15, 5, 9, 1, 0, 8, 14, 3, 11, 12, 13, 7, 10, 6],
  [12, 9, 15, 14, 8, 1, 3, 10, 2, 7, 4, 13, 6, 0, 11, 5],
  [13, 8, 14, 12, 7, 3, 9, 10, 1, 5, 2, 4, 6, 15, 0, 11],
  [14, 9, 11, 2, 5, 15, 7, 1, 0, 13, 12, 6, 10, 4, 3, 8],
  [3, 14, 5, 9, 6, 8, 0, 13, 10, 11, 7, 12, 2, 1, 15, 4],
  [8, 15, 6, 11, 1, 9, 12, 5, 13, 3, 7, 10, 0, 14, 2, 4],
  [9, 11, 12, 0, 3, 6, 7, 5, 4, 8, 14, 15, 1, 10, 2, 13],
  [12, 6, 5, 2, 11, 0, 9, 13, 3, 14, 7, 10, 15, 4, 1, 8]
];
var ID_GOSTR_3411_94_TEST_PARAM_SET = [
  [4, 10, 9, 2, 13, 8, 0, 14, 6, 11, 1, 12, 7, 15, 5, 3],
  [14, 11, 4, 12, 6, 13, 15, 10, 2, 3, 8, 1, 0, 7, 5, 9],
  [5, 8, 1, 13, 10, 3, 4, 2, 14, 15, 12, 7, 6, 0, 9, 11],
  [7, 13, 10, 1, 0, 8, 9, 15, 14, 4, 6, 12, 11, 2, 5, 3],
  [6, 12, 7, 1, 5, 15, 13, 8, 4, 10, 9, 14, 0, 3, 11, 2],
  [4, 11, 10, 0, 7, 2, 1, 13, 3, 6, 8, 5, 9, 12, 15, 14],
  [13, 11, 4, 1, 3, 15, 5, 9, 0, 10, 14, 7, 6, 8, 2, 12],
  [1, 15, 13, 0, 5, 7, 10, 4, 9, 2, 3, 14, 6, 11, 8, 12]
];
var ID_GOSTR_3411_94_CRYPTOPRO_PARAM_SET = [
  [10, 4, 5, 6, 8, 1, 3, 7, 13, 12, 14, 0, 9, 2, 11, 15],
  [5, 15, 4, 0, 2, 13, 11, 9, 1, 7, 6, 3, 12, 14, 10, 8],
  [7, 15, 12, 14, 9, 4, 1, 0, 3, 11, 5, 2, 6, 10, 8, 13],
  [4, 10, 7, 12, 0, 15, 2, 8, 14, 1, 6, 5, 13, 11, 9, 3],
  [7, 6, 4, 11, 9, 12, 2, 10, 1, 8, 0, 14, 15, 13, 3, 5],
  [7, 6, 2, 4, 13, 9, 15, 0, 10, 1, 5, 11, 8, 14, 12, 3],
  [13, 14, 4, 1, 7, 0, 5, 10, 3, 12, 8, 15, 6, 2, 9, 11],
  [1, 3, 10, 9, 5, 11, 4, 15, 8, 6, 7, 14, 13, 0, 2, 12]
];
var EAC_PARAM_SET = [
  [11, 4, 8, 10, 9, 7, 0, 3, 1, 6, 2, 15, 14, 5, 12, 13],
  [1, 7, 14, 9, 11, 3, 15, 12, 0, 5, 4, 6, 13, 10, 8, 2],
  [7, 3, 1, 9, 2, 4, 13, 15, 8, 10, 12, 6, 5, 0, 11, 14],
  [10, 5, 15, 7, 14, 11, 3, 9, 2, 8, 1, 12, 0, 4, 6, 13],
  [0, 14, 6, 11, 9, 3, 8, 4, 12, 15, 10, 5, 13, 7, 1, 2],
  [9, 2, 11, 12, 0, 4, 5, 6, 3, 15, 13, 8, 1, 7, 14, 10],
  [4, 0, 14, 1, 5, 11, 8, 3, 12, 2, 9, 7, 6, 10, 13, 15],
  [7, 14, 12, 13, 9, 4, 8, 15, 10, 2, 6, 0, 3, 11, 5, 1]
];
var sboxes = {
  ID_TC26_GOST_28147_PARAM_Z,
  ID_GOST_28147_89_CRYPTO_PRO_A_PARAM_SET,
  ID_GOST_28147_89_CRYPTO_PRO_B_PARAM_SET,
  ID_GOST_28147_89_CRYPTO_PRO_C_PARAM_SET,
  ID_GOST_28147_89_CRYPTO_PRO_D_PARAM_SET,
  ID_GOST_28147_89_TEST_PARAM_SET,
  ID_GOSTR_3411_94_TEST_PARAM_SET,
  ID_GOSTR_3411_94_CRYPTOPRO_PARAM_SET,
  EAC_PARAM_SET,
  DSSZZI_UA_DKE_1,
  DSSZZI_UA_DKE_2,
  DSSZZI_UA_DKE_3,
  DSSZZI_UA_DKE_4,
  DSSZZI_UA_DKE_5,
  DSSZZI_UA_DKE_6,
  DSSZZI_UA_DKE_7,
  DSSZZI_UA_DKE_8,
  DSSZZI_UA_DKE_9,
  DSSZZI_UA_DKE_10
};
var BLOCK_SIZE = 8;
var KEY_SIZE = KEYSIZE;
var CipherError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CipherError";
  }
};
var keySequences = {
  ENCRYPT: [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
    0
  ],
  DECRYPT: [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
    0,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
    0,
    7,
    6,
    5,
    4,
    3,
    2,
    1,
    0
  ],
  MAC: [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]
};

// node_modules/@li0ard/magma/dist/modes/ecb.js
var encryptECB = (key, data, legacy = false, sbox = sboxes.ID_TC26_GOST_28147_PARAM_Z) => {
  const cipher = new Magma(legacy ? Magma.reverseKey(key) : key, sbox);
  const result = ecb_encrypt((legacy ? cipher.encryptLegacy : cipher.encryptBlock).bind(cipher), BLOCK_SIZE, data);
  return result;
};

// node_modules/@li0ard/magma/dist/index.js
var Magma = class _Magma {
  /**
   * Magma core class
   * @param key Encryption key
   * @param sbox S-Box
   */
  constructor(key, sbox = sboxes.ID_TC26_GOST_28147_PARAM_Z) {
    __publicField(this, "key");
    __publicField(this, "sbox");
    __publicField(this, "roundKeys", []);
    this.key = key;
    this.sbox = sbox;
    if (key.length !== KEY_SIZE)
      throw new CipherError("Invalid key length");
    this.roundKeys = this.regenerateRoundKeys(keySequences.ENCRYPT);
  }
  /** Regenerate round keys for sequence */
  regenerateRoundKeys(sequence) {
    const keyChunks = [];
    for (let j = 0; j < 8; j++)
      keyChunks.push(_Magma.bytesToU32(this.key.slice(j * 4, j * 4 + 4)));
    let roundKeys = new Array(sequence.length);
    for (let i = 0; i < sequence.length; i++)
      roundKeys[i] = keyChunks[sequence[i]];
    return roundKeys;
  }
  /**
   * Applies substitution transformation (T-transformation) using S-box.
   * Breaks input value into 4-bit parts, substitutes each part using corresponding S-box row,
   * and reconstructs transformed value.
   * @param value Value to be transformed
   * @returns {number} Transformed 32-bit value after substitution
  */
  transformT(value) {
    let result = 0;
    for (let i = 0; i < 8; i++)
      result |= this.sbox[i][value >> 4 * i & 15] << 4 * i;
    return result >>> 0;
  }
  /**
   * Applies the G-transformation (Feistel round function) to input value.
   * Performs addition with round key, applies T-transformation, and performs cyclic left shift.
   * @param a Input 32-bit value to be transformed
   * @param k Round key used in the transformation
   * @returns {number} Transformed 32-bit value after G-transformation
   */
  transformG(a, k) {
    const substituted = this.transformT(a + k >>> 0);
    return (substituted << 11 | substituted >>> 21) >>> 0;
  }
  /**
   * Returns round keys
   * @returns {number[]}
   */
  getRoundKeys() {
    return [...this.roundKeys];
  }
  /**
   * Proceed single block of data using Magma cipher
   * @param block Block
   * @param sequence Sequence of `K_i` S-Box applying
   * @returns {Uint8Array} Proceeded block
   * @throws {CipherError} Block size is invalid or data is too short
   */
  proceedBlock(block, sequence) {
    let roundKeys = this.regenerateRoundKeys(sequence);
    if (block.length !== BLOCK_SIZE)
      throw new CipherError("Invalid block size");
    let a0 = _Magma.bytesToU32(block.slice(0, 4));
    let a1 = _Magma.bytesToU32(block.slice(4, 8));
    for (let i = 0; i < roundKeys.length; i++) {
      const temp = a1;
      a1 = a0 ^ this.transformG(a1, roundKeys[i]);
      a0 = temp;
    }
    return concatBytes3(_Magma.u32ToBytes(a1), _Magma.u32ToBytes(a0));
  }
  /**
   * Encrypts single block of data using Magma cipher.
   * @param block Block to be encrypted
   */
  encryptBlock(block) {
    return this.proceedBlock(block, keySequences.ENCRYPT);
  }
  /**
   * Decrypts single block of data using Magma cipher.
   * @param block Block to be decrypted
   */
  decryptBlock(block) {
    return this.proceedBlock(block, keySequences.DECRYPT);
  }
  /** Encrypt single block of data using old Magma (GOST 28147-89) algorithm */
  encryptLegacy(block) {
    return _Magma.reverseChunks(this.encryptBlock(_Magma.reverseChunks(block)));
  }
  /** Decrypt single block of data using old Magma (GOST 28147-89) algorithm */
  decryptLegacy(block) {
    return _Magma.reverseChunks(this.decryptBlock(_Magma.reverseChunks(block)));
  }
  /** Convert bytes to uint32 number */
  static bytesToU32(bytes) {
    return (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
  }
  /** Convert uint32 number to bytes */
  static u32ToBytes(value) {
    return new Uint8Array([value >> 24 & 255, value >> 16 & 255, value >> 8 & 255, value & 255]);
  }
  /** Backward compatibility key preparation for 28147-89 key schedule */
  static reverseKey(key) {
    const result = new Uint8Array(KEY_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i++)
      result.set(new Uint8Array(key.slice(i * 4, i * 4 + 4)).reverse(), i * 4);
    return result;
  }
  /** Backward compatibility block preparation for 28147-89 */
  static reverseChunks(data) {
    const chunks = [];
    for (let i = 0; i < data.length; i += BLOCK_SIZE)
      chunks.push(new Uint8Array(data.slice(i, i + BLOCK_SIZE)).reverse());
    return concatBytes3(...chunks);
  }
};

// node_modules/@li0ard/gost341194/dist/const.js
var sboxes2 = sboxes;
var DEFAULT_SBOX = sboxes2.ID_GOSTR_3411_94_CRYPTOPRO_PARAM_SET;
var BLOCKSIZE = 32;
var C2 = new Uint8Array(32);
var C3 = new Uint8Array([
  255,
  0,
  255,
  255,
  0,
  0,
  0,
  255,
  255,
  0,
  0,
  255,
  0,
  255,
  255,
  0,
  0,
  255,
  0,
  255,
  0,
  255,
  0,
  255,
  255,
  0,
  255,
  0,
  255,
  0,
  255,
  0
]);
var C4 = new Uint8Array(32);

// node_modules/@li0ard/gost341194/dist/index.js
var A = (x) => {
  let x2 = x.slice(16, 24), x1 = x.slice(24, 32);
  return concatBytes2(xor(x1, x2), x.slice(0, 8), x.slice(8, 16), x2);
};
var P = (x) => {
  return new Uint8Array([x[0], x[8], x[16], x[24], x[1], x[9], x[17], x[25], x[2], x[10], x[18], x[26], x[3], x[11], x[19], x[27], x[4], x[12], x[20], x[28], x[5], x[13], x[21], x[29], x[6], x[14], x[22], x[30], x[7], x[15], x[23], x[31]]);
};
var _chi = (Y) => {
  const byx = new Uint8Array(2);
  byx[0] = Y[30] ^ Y[28] ^ Y[26] ^ Y[24] ^ Y[6] ^ Y[0];
  byx[1] = Y[31] ^ Y[29] ^ Y[27] ^ Y[25] ^ Y[7] ^ Y[1];
  const result = new Uint8Array(32);
  result.set(byx, 0);
  for (let i = 0; i < 30; i += 2) {
    result[i + 2] = Y[i];
    result[i + 3] = Y[i + 1];
  }
  return result;
};
var _step = (hin, m, sbox) => {
  let u = hin;
  let v = m;
  let w = xor(hin, m);
  let k1 = P(w);
  u = xor(A(u), C2);
  v = A(A(v));
  w = xor(u, v);
  let k2 = P(w);
  u = xor(A(u), C3);
  v = A(A(v));
  w = xor(u, v);
  let k3 = P(w);
  u = xor(A(u), C4);
  v = A(A(v));
  w = xor(u, v);
  let k4 = P(w);
  let s = concatBytes2(encryptECB(k4.slice().reverse(), hin.slice(0, 8).reverse(), true, sbox).reverse(), encryptECB(k3.slice().reverse(), hin.slice(8, 16).reverse(), true, sbox).reverse(), encryptECB(k2.slice().reverse(), hin.slice(16, 24).reverse(), true, sbox).reverse(), encryptECB(k1.slice().reverse(), hin.slice(24, 32).reverse(), true, sbox).reverse());
  let x = new Uint8Array(s);
  for (let i = 0; i < 12; i++)
    x = _chi(x);
  x = xor(x, m);
  x = _chi(x);
  x = xor(hin, x);
  for (let i = 0; i < 61; i++)
    x = _chi(x);
  return x;
};
var Gost341194 = class _Gost341194 {
  /**
   * GOST R 34.11-94 constructor
   * @param data Data to be hashed (optional, can be updated using `update` method)
   * @param sbox S-Box (optional, default is `ID_GOSTR_3411_94_CRYPTOPRO_PARAM_SET`)
   */
  constructor(data = new Uint8Array(), sbox = DEFAULT_SBOX) {
    __publicField(this, "data");
    __publicField(this, "sbox");
    __publicField(this, "blockLen", BLOCKSIZE);
    __publicField(this, "outputLen", 32);
    this.data = data;
    this.sbox = sbox;
  }
  /** Create hash instance */
  static create() {
    return new _Gost341194();
  }
  /** Reset hash state */
  reset() {
    this.data = new Uint8Array();
  }
  /** Reset hash state */
  destroy() {
    this.reset();
  }
  /** Clone hash instance */
  clone() {
    return this._cloneInto();
  }
  _cloneInto(to) {
    to || (to = new _Gost341194());
    to.data = this.data.slice();
    to.sbox = this.sbox;
    return to;
  }
  /** Update hash buffer */
  update(data) {
    this.data = concatBytes2(this.data, data);
    return this;
  }
  /**
   * Finalize hash computation and write result into Uint8Array
   * @param buf Output Uint8Array
   */
  digestInto(buf) {
    let len = 0n;
    let checksum = 0n;
    let h = new Uint8Array(32);
    let m = new Uint8Array(this.data);
    for (let i = 0; i < m.length; i += BLOCKSIZE) {
      let part = m.slice(i, i + BLOCKSIZE).reverse();
      len += BigInt(part.length) * 8n;
      checksum = checksum + bytesToNumberBE2(part) & 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
      if (part.length < BLOCKSIZE)
        part = numberToBytesBE2(bytesToNumberBE2(part), BLOCKSIZE);
      h = _step(h, part, this.sbox);
    }
    h = _step(_step(h, numberToBytesBE2(len, BLOCKSIZE), this.sbox), numberToBytesBE2(checksum, BLOCKSIZE), this.sbox);
    buf.set(h.reverse());
    this.reset();
    return buf;
  }
  /** Finalize hash computation and return result as Uint8Array */
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
};
var gost341194 = (input, sbox = DEFAULT_SBOX) => new Gost341194(input, sbox).digest();

// node_modules/@li0ard/streebog/dist/const.js
var BLOCKSIZE2 = 64;
var PI = new Uint8Array([
  252,
  238,
  221,
  17,
  207,
  110,
  49,
  22,
  251,
  196,
  250,
  218,
  35,
  197,
  4,
  77,
  233,
  119,
  240,
  219,
  147,
  46,
  153,
  186,
  23,
  54,
  241,
  187,
  20,
  205,
  95,
  193,
  249,
  24,
  101,
  90,
  226,
  92,
  239,
  33,
  129,
  28,
  60,
  66,
  139,
  1,
  142,
  79,
  5,
  132,
  2,
  174,
  227,
  106,
  143,
  160,
  6,
  11,
  237,
  152,
  127,
  212,
  211,
  31,
  235,
  52,
  44,
  81,
  234,
  200,
  72,
  171,
  242,
  42,
  104,
  162,
  253,
  58,
  206,
  204,
  181,
  112,
  14,
  86,
  8,
  12,
  118,
  18,
  191,
  114,
  19,
  71,
  156,
  183,
  93,
  135,
  21,
  161,
  150,
  41,
  16,
  123,
  154,
  199,
  243,
  145,
  120,
  111,
  157,
  158,
  178,
  177,
  50,
  117,
  25,
  61,
  255,
  53,
  138,
  126,
  109,
  84,
  198,
  128,
  195,
  189,
  13,
  87,
  223,
  245,
  36,
  169,
  62,
  168,
  67,
  201,
  215,
  121,
  214,
  246,
  124,
  34,
  185,
  3,
  224,
  15,
  236,
  222,
  122,
  148,
  176,
  188,
  220,
  232,
  40,
  80,
  78,
  51,
  10,
  74,
  167,
  151,
  96,
  115,
  30,
  0,
  98,
  68,
  26,
  184,
  56,
  130,
  100,
  159,
  38,
  65,
  173,
  69,
  70,
  146,
  39,
  94,
  85,
  47,
  140,
  163,
  165,
  125,
  105,
  213,
  149,
  59,
  7,
  88,
  179,
  64,
  134,
  172,
  29,
  247,
  48,
  55,
  107,
  228,
  136,
  217,
  231,
  137,
  225,
  27,
  131,
  73,
  76,
  63,
  248,
  254,
  141,
  83,
  170,
  144,
  202,
  216,
  133,
  97,
  32,
  113,
  103,
  164,
  45,
  43,
  9,
  91,
  203,
  155,
  37,
  208,
  190,
  229,
  108,
  82,
  89,
  166,
  116,
  210,
  230,
  244,
  180,
  192,
  209,
  102,
  175,
  194,
  57,
  75,
  99,
  182
]);
var TAU = new Uint8Array([
  0,
  8,
  16,
  24,
  32,
  40,
  48,
  56,
  1,
  9,
  17,
  25,
  33,
  41,
  49,
  57,
  2,
  10,
  18,
  26,
  34,
  42,
  50,
  58,
  3,
  11,
  19,
  27,
  35,
  43,
  51,
  59,
  4,
  12,
  20,
  28,
  36,
  44,
  52,
  60,
  5,
  13,
  21,
  29,
  37,
  45,
  53,
  61,
  6,
  14,
  22,
  30,
  38,
  46,
  54,
  62,
  7,
  15,
  23,
  31,
  39,
  47,
  55,
  63
]);
var A2 = new Uint32Array([
  2384525991,
  731952240,
  1192263133,
  2605734456,
  2903027936,
  3274190108,
  3624163440,
  4011104270,
  1812081720,
  4178201607,
  906040860,
  4060423821,
  462293774,
  2039223240,
  2202503943,
  2990966628,
  2685522816,
  2173603648,
  1351018304,
  3460811040,
  675544352,
  1739450896,
  347074576,
  3185079560,
  182024200,
  3496784900,
  98712580,
  1748392450,
  2356223490,
  874196225,
  1186336513,
  444831886,
  2430252330,
  947578735,
  1215157269,
  473824697,
  616065668,
  244379858,
  308032834,
  122189929,
  154047521,
  2367962298,
  2316782238,
  3356630621,
  1166353743,
  1678315424,
  2899090601,
  847939920,
  2639130717,
  1600525393,
  3232266400,
  2704476838,
  1616133200,
  3734439251,
  808066600,
  1875217575,
  404033300,
  3119269597,
  210012426,
  3530957792,
  105040389,
  1765515120,
  52520332,
  3130245432,
  2250726896,
  2632493736,
  1134403704,
  1316246868,
  2948616252,
  658154538,
  3646957598,
  2635944469,
  3794801679,
  3229624708,
  1897400969,
  1614846530,
  3054241226,
  807423265,
  1527155813,
  403744926,
  1164719240,
  2050491833,
  2889226820,
  1025281234,
  1444613410,
  2416854633,
  730040337,
  1208427450,
  2614051974,
  613261149,
  3286835779,
  315146656,
  4026143151,
  157609552,
  4185753305,
  2318563112,
  3841597524,
  2819306140,
  1920798762,
  1418402126,
  967837717,
  717980199,
  2455241860,
  367739293,
  1227620930,
  2231086784,
  2853568801,
  1123243872,
  1426820766,
  569877808,
  2760591183,
  2666912792,
  1889969518,
  608197006,
  945019959,
  304128583,
  480734869,
  152064429,
  249378756,
  2315822808,
  132158818,
  1157911404,
  2372977713,
  2885855030,
  3359138454,
  1442962715,
  1679569227,
  730783875
]);
var C = [
  new Uint8Array([
    177,
    8,
    91,
    218,
    30,
    202,
    218,
    233,
    235,
    203,
    47,
    129,
    192,
    101,
    124,
    31,
    47,
    106,
    118,
    67,
    46,
    69,
    208,
    22,
    113,
    78,
    184,
    141,
    117,
    133,
    196,
    252,
    75,
    124,
    224,
    145,
    146,
    103,
    105,
    1,
    162,
    66,
    42,
    8,
    164,
    96,
    211,
    21,
    5,
    118,
    116,
    54,
    204,
    116,
    77,
    35,
    221,
    128,
    101,
    89,
    242,
    166,
    69,
    7
  ]),
  new Uint8Array([
    111,
    163,
    181,
    138,
    169,
    157,
    47,
    26,
    79,
    227,
    157,
    70,
    15,
    112,
    181,
    215,
    243,
    254,
    234,
    114,
    10,
    35,
    43,
    152,
    97,
    213,
    94,
    15,
    22,
    181,
    1,
    49,
    154,
    181,
    23,
    107,
    18,
    214,
    153,
    88,
    92,
    181,
    97,
    194,
    219,
    10,
    167,
    202,
    85,
    221,
    162,
    27,
    215,
    203,
    205,
    86,
    230,
    121,
    4,
    112,
    33,
    177,
    155,
    183
  ]),
  new Uint8Array([
    245,
    116,
    220,
    172,
    43,
    206,
    47,
    199,
    10,
    57,
    252,
    40,
    106,
    61,
    132,
    53,
    6,
    241,
    94,
    95,
    82,
    156,
    31,
    139,
    242,
    234,
    117,
    20,
    177,
    41,
    123,
    123,
    211,
    226,
    15,
    228,
    144,
    53,
    158,
    177,
    193,
    201,
    58,
    55,
    96,
    98,
    219,
    9,
    194,
    182,
    244,
    67,
    134,
    122,
    219,
    49,
    153,
    30,
    150,
    245,
    10,
    186,
    10,
    178
  ]),
  new Uint8Array([
    239,
    31,
    223,
    179,
    232,
    21,
    102,
    210,
    249,
    72,
    225,
    160,
    93,
    113,
    228,
    221,
    72,
    142,
    133,
    126,
    51,
    92,
    60,
    125,
    157,
    114,
    28,
    173,
    104,
    94,
    53,
    63,
    169,
    215,
    44,
    130,
    237,
    3,
    214,
    117,
    216,
    183,
    19,
    51,
    147,
    82,
    3,
    190,
    52,
    83,
    234,
    161,
    147,
    232,
    55,
    241,
    34,
    12,
    190,
    188,
    132,
    227,
    209,
    46
  ]),
  new Uint8Array([
    75,
    234,
    107,
    172,
    173,
    71,
    71,
    153,
    154,
    63,
    65,
    12,
    108,
    169,
    35,
    99,
    127,
    21,
    28,
    31,
    22,
    134,
    16,
    74,
    53,
    158,
    53,
    215,
    128,
    15,
    255,
    189,
    191,
    205,
    23,
    71,
    37,
    58,
    245,
    163,
    223,
    255,
    0,
    183,
    35,
    39,
    26,
    22,
    122,
    86,
    162,
    126,
    169,
    234,
    99,
    245,
    96,
    23,
    88,
    253,
    124,
    108,
    254,
    87
  ]),
  new Uint8Array([
    174,
    79,
    174,
    174,
    29,
    58,
    211,
    217,
    111,
    164,
    195,
    59,
    122,
    48,
    57,
    192,
    45,
    102,
    196,
    249,
    81,
    66,
    164,
    108,
    24,
    127,
    154,
    180,
    154,
    240,
    142,
    198,
    207,
    250,
    166,
    183,
    28,
    154,
    183,
    180,
    10,
    242,
    31,
    102,
    194,
    190,
    198,
    182,
    191,
    113,
    197,
    114,
    54,
    144,
    79,
    53,
    250,
    104,
    64,
    122,
    70,
    100,
    125,
    110
  ]),
  new Uint8Array([
    244,
    199,
    14,
    22,
    238,
    170,
    197,
    236,
    81,
    172,
    134,
    254,
    191,
    36,
    9,
    84,
    57,
    158,
    198,
    199,
    230,
    191,
    135,
    201,
    211,
    71,
    62,
    51,
    25,
    122,
    147,
    201,
    9,
    146,
    171,
    197,
    45,
    130,
    44,
    55,
    6,
    71,
    105,
    131,
    40,
    74,
    5,
    4,
    53,
    23,
    69,
    76,
    162,
    60,
    74,
    243,
    136,
    134,
    86,
    77,
    58,
    20,
    212,
    147
  ]),
  new Uint8Array([
    155,
    31,
    91,
    66,
    77,
    147,
    201,
    167,
    3,
    231,
    170,
    2,
    12,
    110,
    65,
    65,
    78,
    183,
    248,
    113,
    156,
    54,
    222,
    30,
    137,
    180,
    68,
    59,
    77,
    219,
    196,
    154,
    244,
    137,
    43,
    203,
    146,
    155,
    6,
    144,
    105,
    209,
    141,
    43,
    209,
    165,
    196,
    47,
    54,
    172,
    194,
    53,
    89,
    81,
    168,
    217,
    164,
    127,
    13,
    212,
    191,
    2,
    231,
    30
  ]),
  new Uint8Array([
    55,
    143,
    90,
    84,
    22,
    49,
    34,
    155,
    148,
    76,
    154,
    216,
    236,
    22,
    95,
    222,
    58,
    125,
    58,
    27,
    37,
    137,
    66,
    36,
    60,
    217,
    85,
    183,
    224,
    13,
    9,
    132,
    128,
    10,
    68,
    11,
    219,
    178,
    206,
    177,
    123,
    43,
    138,
    154,
    166,
    7,
    156,
    84,
    14,
    56,
    220,
    146,
    203,
    31,
    42,
    96,
    114,
    97,
    68,
    81,
    131,
    35,
    90,
    219
  ]),
  new Uint8Array([
    171,
    190,
    222,
    166,
    128,
    5,
    111,
    82,
    56,
    42,
    229,
    72,
    178,
    228,
    243,
    243,
    137,
    65,
    231,
    28,
    255,
    138,
    120,
    219,
    31,
    255,
    225,
    138,
    27,
    51,
    97,
    3,
    159,
    231,
    103,
    2,
    175,
    105,
    51,
    75,
    122,
    30,
    108,
    48,
    59,
    118,
    82,
    244,
    54,
    152,
    250,
    209,
    21,
    59,
    182,
    195,
    116,
    180,
    199,
    251,
    152,
    69,
    156,
    237
  ]),
  new Uint8Array([
    123,
    205,
    158,
    208,
    239,
    200,
    137,
    251,
    48,
    2,
    198,
    205,
    99,
    90,
    254,
    148,
    216,
    250,
    107,
    187,
    235,
    171,
    7,
    97,
    32,
    1,
    128,
    33,
    20,
    132,
    102,
    121,
    138,
    29,
    113,
    239,
    234,
    72,
    185,
    202,
    239,
    186,
    205,
    29,
    125,
    71,
    110,
    152,
    222,
    162,
    89,
    74,
    192,
    111,
    216,
    93,
    107,
    202,
    164,
    205,
    129,
    243,
    45,
    27
  ]),
  new Uint8Array([
    55,
    142,
    231,
    103,
    241,
    22,
    49,
    186,
    210,
    19,
    128,
    176,
    4,
    73,
    177,
    122,
    205,
    164,
    60,
    50,
    188,
    223,
    29,
    119,
    248,
    32,
    18,
    212,
    48,
    33,
    159,
    155,
    93,
    128,
    239,
    157,
    24,
    145,
    204,
    134,
    231,
    29,
    164,
    170,
    136,
    225,
    40,
    82,
    250,
    244,
    23,
    213,
    217,
    178,
    27,
    153,
    72,
    188,
    146,
    74,
    241,
    27,
    215,
    32
  ])
];

// node_modules/@li0ard/streebog/dist/utils.js
var xor3 = (a, b) => {
  let mlen = Math.min(a.length, b.length);
  let result = new Uint8Array(mlen);
  for (let i = 0; i < mlen; i++)
    result[i] = a[i] ^ b[i];
  return result.slice();
};
var add512 = (a, b) => {
  const c = new Uint8Array(64);
  const tmpA = new Uint8Array(64);
  const tmpB = new Uint8Array(64);
  for (let i = 0; i < a.length; i++)
    tmpA[63 - i] = a[a.length - i - 1];
  for (let i = 0; i < b.length; i++)
    tmpB[63 - i] = b[b.length - i - 1];
  for (let i = 63, tmp = 0; i >= 0; i--) {
    tmp = tmpA[i] + tmpB[i] + (tmp >> 8);
    c[i] = tmp & 255;
  }
  return c;
};
var transformS = (input) => {
  const result = new Uint8Array(BLOCKSIZE2);
  for (let i = 0; i < BLOCKSIZE2; i++)
    result[i] = PI[input[i]];
  return result;
};
var transformP = (input) => {
  const result = new Uint8Array(BLOCKSIZE2);
  for (let i = 0; i < BLOCKSIZE2; i++)
    result[i] = input[TAU[i]];
  return result;
};
var transformL = (input) => {
  const result = new Uint8Array(BLOCKSIZE2);
  for (let i = 0; i < 8; i++) {
    const parts = new Uint32Array(2);
    const tmp = input.slice(i * 8, i * 8 + 8).reverse();
    for (let j = 0; j < 8; j++) {
      for (let k = 0; k < 8; k++) {
        if (tmp[7 - j] >> 7 - k & 1) {
          parts[0] ^= A2[j * 16 + k * 2];
          parts[1] ^= A2[j * 16 + k * 2 + 1];
        }
      }
    }
    result[i * 8] = parts[0] >> 24;
    result[i * 8 + 1] = parts[0] << 8 >> 24;
    result[i * 8 + 2] = parts[0] << 16 >> 24;
    result[i * 8 + 3] = parts[0] << 24 >> 24;
    result[i * 8 + 4] = parts[1] >> 24;
    result[i * 8 + 5] = parts[1] << 8 >> 24;
    result[i * 8 + 6] = parts[1] << 16 >> 24;
    result[i * 8 + 7] = parts[1] << 24 >> 24;
  }
  return result;
};
var transformE = (block, keys) => {
  let c = xor3(block, keys);
  for (let i = 0; i < 12; i++) {
    block = transformL(transformP(transformS(xor3(block, C[i]))));
    c = xor3(transformL(transformP(transformS(c))), block);
  }
  return c;
};
var transformG = (hash, n, message) => {
  return xor3(xor3(transformE(transformL(transformP(transformS(xor3(n, hash)))), message), n), message);
};
var asciis3 = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase163(ch) {
  if (ch >= asciis3._0 && ch <= asciis3._9)
    return ch - asciis3._0;
  if (ch >= asciis3.A && ch <= asciis3.F)
    return ch - (asciis3.A - 10);
  if (ch >= asciis3.a && ch <= asciis3.f)
    return ch - (asciis3.a - 10);
  return;
}
function hexToBytes3(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase163(hex.charCodeAt(hi));
    const n2 = asciiToBase163(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function numberToBytesBE4(n, len) {
  let num = n.toString(16).padStart(len * 2, "0");
  while (num.length % 2 != 0)
    num = "0" + num;
  return hexToBytes3(num);
}
var getPadLength2 = (dataLength) => {
  if (dataLength < BLOCKSIZE2)
    return BLOCKSIZE2 - dataLength;
  if (dataLength % BLOCKSIZE2 == 0)
    return 0;
  return BLOCKSIZE2 - dataLength % BLOCKSIZE2;
};
var pad = (data) => {
  const padded = new Uint8Array(data.length + getPadLength2(data.length));
  padded.set(data);
  return padded;
};

// node_modules/@li0ard/streebog/dist/hmac.js
var Streebog256HMAC = (key) => new HMAC(createHasher(Streebog256.create), key);

// node_modules/@li0ard/streebog/dist/kdf.js
var kdf_tree_gostr3411_2012_256 = (key, label, seed, keys, i_len = 1) => {
  const keymat = [];
  const length = numberToBytesBE4(BigInt(keys) * 32n * 8n, 1);
  for (let i = 0; i < keys; i++)
    keymat.push(Streebog256HMAC(key).update(concatBytes(numberToBytesBE4(i + 1, i_len), label, hexToBytes("00"), seed, length)).digest());
  return keymat;
};

// node_modules/@li0ard/streebog/dist/index.js
var Streebog = class {
  /**
   * Streebog core constructor
   * @param is512 Use 512 bits version of algorithm
   */
  constructor(is512) {
    __publicField(this, "is512");
    __publicField(this, "buffer");
    __publicField(this, "blockLen", BLOCKSIZE2);
    __publicField(this, "outputLen");
    this.is512 = is512;
    this.buffer = new Uint8Array();
    this.outputLen = is512 ? 64 : 32;
  }
  /** Reset hash state */
  reset() {
    this.buffer = new Uint8Array();
  }
  /** Reset hash state */
  destroy() {
    this.reset();
  }
  /** Update hash buffer */
  update(data) {
    this.buffer = concatBytes(this.buffer, data);
    return this;
  }
  /** Finalize hash computation and return result as Uint8Array */
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  /**
   * Finalize hash computation and write result into Uint8Array
   * @param buf - Output Uint8Array
   */
  digestInto(buf) {
    const message = this.buffer.slice().reverse();
    let n = new Uint8Array(BLOCKSIZE2);
    let sigma = new Uint8Array(BLOCKSIZE2);
    let hash = new Uint8Array(64).fill(this.is512 ? 0 : 1);
    let blocks = 1;
    for (let i = message.length; i >= BLOCKSIZE2; i -= BLOCKSIZE2) {
      const pos = message.length - blocks * BLOCKSIZE2;
      hash = transformG(n, hash, message.slice(pos, pos + BLOCKSIZE2));
      n = add512(n, new Uint8Array([0, 0, 2, 0]));
      sigma = add512(sigma, message.slice(pos, pos + BLOCKSIZE2));
      blocks++;
    }
    let paddedMsg = new Uint8Array(BLOCKSIZE2);
    const msg = message.slice(0, message.length - (blocks - 1) * 64);
    if (msg.length < BLOCKSIZE2) {
      paddedMsg = pad(paddedMsg);
      paddedMsg[BLOCKSIZE2 - msg.length - 1] = 1;
      for (let i = 0; i < msg.length; i++)
        paddedMsg[BLOCKSIZE2 - msg.length + i] = msg[i];
    }
    const msgLen = new Uint8Array(4);
    for (let i = 0; i < 4; i++)
      msgLen[i] = msg.length * 8 >> i * 8 & 255;
    hash = transformG(new Uint8Array(64), transformG(new Uint8Array(64), transformG(n, hash, paddedMsg), add512(n, msgLen.reverse())), add512(sigma, paddedMsg));
    if (this.is512)
      buf.set(hash.slice().reverse());
    else
      buf.set(hash.slice(0, 32).reverse());
    this.reset();
    return buf;
  }
};
var Streebog256 = class _Streebog256 extends Streebog {
  /** Streebog 256 aka `GOST R 34.11-2012 256 bits` */
  constructor() {
    super(false);
  }
  /** Create hash instance */
  static create() {
    return new _Streebog256();
  }
  /** Clone hash instance */
  clone() {
    return this._cloneInto();
  }
  _cloneInto(to) {
    to || (to = new _Streebog256());
    to.buffer = this.buffer.slice();
    return to;
  }
};
var Streebog512 = class _Streebog512 extends Streebog {
  /** Streebog 512 bit aka `GOST R 34.11-2012 512 bits` */
  constructor() {
    super(true);
  }
  /** Create hash instance */
  static create() {
    return new _Streebog512();
  }
  /** Clone hash instance */
  clone() {
    return this._cloneInto();
  }
  _cloneInto(to) {
    to || (to = new _Streebog512());
    to.buffer = this.buffer.slice();
    return to;
  }
};
var streebog256 = (input) => new Streebog256().update(input).digest();
var streebog512 = (input) => new Streebog512().update(input).digest();

// node_modules/@li0ard/gostcurves/dist/vko.js
var kek = (parameters, prv, pub, ukm) => {
  let Fn = Field(parameters.n);
  let key = weierstrassN(parameters).fromBytes(pub).multiply(bytesToNumberBE(prv)).multiply(Fn.mulN(parameters.h, bytesToNumberBE(ukm)));
  return concatBytes(numberToBytesLE(key.x, parameters.length), numberToBytesLE(key.y, parameters.length));
};
var kek_34102001 = (parameters, prv, pub, ukm) => gost341194(kek(parameters, prv, pub, ukm));
var kek_34102012256 = (parameters, prv, pub, ukm) => streebog256(kek(parameters, prv, pub, ukm));
var kek_34102012512 = (parameters, prv, pub, ukm) => streebog512(kek(parameters, prv, pub, ukm));
var keg = (parameters, prv, pub, h) => {
  if (h.length !== 32)
    throw new Error("Invalid 'h' length. Must be 32 bytes");
  if (parameters.length == 64)
    return kek_34102012512(parameters, prv, pub, h.slice(0, 16));
  let k_exp = kek_34102012256(parameters, prv, pub, h.slice(0, 16));
  return concatBytes(...kdf_tree_gostr3411_2012_256(k_exp, hexToBytes("6b64662074726565"), h.slice(16, 24), 2));
};

// node_modules/@li0ard/gostcurves/dist/conversion.js
var computeST = (curve) => {
  if (!curve.e || !curve.d)
    throw new Error("No Twisted Edwards parameters");
  if (curve.st && curve.st.length != 0)
    return curve.st;
  let Fp = Field(curve.p);
  return [Fp.div(Fp.sub(curve.e, curve.d), 4n), Fp.div(Fp.add(curve.e, curve.d), 6n)];
};
var uv2xy = (curve, point) => {
  let Fp = Field(curve.p);
  let [s, t] = computeST(curve);
  let s1v = Fp.mul(s, Fp.add(1n, point.y)), onev = Fp.sub(1n, point.y);
  return { x: Fp.add(t, Fp.div(s1v, onev)), y: Fp.div(s1v, Fp.mul(point.x, onev)) };
};
var xy2uv = (curve, point) => {
  let Fp = Field(curve.p);
  let [s, t] = computeST(curve);
  let xt = Fp.sub(point.x, t);
  return { x: Fp.div(xt, point.y), y: Fp.div(Fp.sub(xt, s), Fp.add(xt, s)) };
};

// node_modules/@li0ard/gostcurves/dist/index.js
var getPublicKey = (parameters, prv) => weierstrassN(parameters).BASE.multiply(bytesToNumberBE(prv)).toBytes(false);
var sign = (parameters, prv, digest, rand) => {
  let size = parameters.length;
  let curve = weierstrassN(parameters);
  let Fn = curve.Fn;
  let e = Fn.fromBytes(digest);
  if (e === 0n)
    e = 1n;
  let prvNum = Fn.fromBytes(prv);
  while (true) {
    rand || (rand = randomBytes(size));
    let k = mod(bytesToNumberBE(rand), parameters.n);
    if (k === 0n)
      continue;
    try {
      let { x: r } = curve.BASE.multiply(k);
      r = Fn.create(r);
      if (r === 0n)
        continue;
      const s = Fn.add(Fn.mul(r, prvNum), Fn.mul(k, e));
      if (s === 0n)
        continue;
      return concatBytes(numberToBytesBE(r, parameters.length), numberToBytesBE(s, parameters.length));
    } catch (e2) {
      if (e2 instanceof Error && e2.message === "invalid scalar: out of range")
        continue;
      throw e2;
    }
  }
};
var verify = (parameters, pub, digest, signature) => {
  let size = parameters.length;
  let curve = weierstrassN(parameters);
  let Fn = curve.Fn;
  if (signature.length != size * 2)
    throw new Error("Invalid signature");
  let r = bytesToNumberBE(signature.slice(0, size));
  let s = bytesToNumberBE(signature.slice(size));
  if (r <= 0 || r >= parameters.n || s <= 0 || s >= parameters.n)
    return false;
  let e = Fn.fromBytes(digest);
  if (e === 0n)
    e = 1n;
  let v = Fn.inv(e);
  let z1 = Fn.mul(s, v), z2 = Fn.mul(r, v);
  let P2, Q;
  try {
    P2 = curve.BASE.multiply(z1);
    Q = curve.fromBytes(pub).multiply(z2).negate();
  } catch {
    return false;
  }
  return Fn.create(P2.add(Q).x) === r;
};
export {
  ID_GOSTR3410_2001_PARAM_SET_CC,
  ID_GOSTR3410_2001_TEST_PARAM_SET,
  ID_GOSTR3410_2012_256_PARAM_SET_A,
  ID_GOSTR3410_2012_256_PARAM_SET_B,
  ID_GOSTR3410_2012_256_PARAM_SET_C,
  ID_GOSTR3410_2012_256_PARAM_SET_D,
  ID_GOSTR3410_2012_512_PARAM_SET_A,
  ID_GOSTR3410_2012_512_PARAM_SET_B,
  ID_GOSTR3410_2012_512_PARAM_SET_C,
  ID_GOSTR3410_2012_512_TEST_PARAM_SET,
  computeST,
  getPublicKey,
  keg,
  kek,
  kek_34102001,
  kek_34102012256,
  kek_34102012512,
  sign,
  uv2xy,
  verify,
  xy2uv
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/utils.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/modular.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/curve.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/weierstrass.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
