// --[[ import ]]
import crypto from "crypto";
// --[ logger ]
function _printer( line:string, line_lengt:number, title:string, ...any:any[] ):undefined
{
  let _line:string = "";
  for ( let c=line_lengt; c; c-- ) _line+=line;
  console.log(`${_line}[ ${title} ][ ${new Date().toLocaleString()} ]${any.length?` : `:``}`, ...any);
  return( undefined );
}
function netlog( path:string, ...desc:string[] )
{
  _printer('-', 8, `PATH:${path}`, ...desc);
}
function netclose( path:string, ...desc:string[] )
{
  _printer('-', 8, `END_PATH:${path}`, ...desc);
}
function log( ...any:any[] ):undefined
{
  _printer('-', 8, "LOG", ...any);
  return( undefined );
}
function errlog( ...any:any[] )
{
  _printer('#', 8, ">> ERROR <<", ...any);
}
function dbg( ...any:any[] )
{
  _printer('+', 8, ">> DEBUG <<", ...any);
}
function fslog()
{
  errlog('log()의 메시지를 파일로 저장하는 함수입니다. 사용불가능한 상태입니다.');
}
// --[ base64 ]
//? 출처 : "https://developer.mozilla.org/en-US/docs/Glossary/Base64"
//? 일부 수정됨.
function _base64ToBytes(base64:string):Uint8Array
{
  let result:Uint8Array = new Uint8Array();
  let decoded:string = "";
  if ( base64.length == 0 ) return( result );
  decoded = atob(base64);
  result = Uint8Array.from(decoded, (m)=>m.codePointAt(0)as number);
  return( result );
}
function _bytesToBase64(bytes:Uint8Array):string
{
  const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join("");
  return btoa(binString);
}
function base64Encode( str:string ):string
{
  return( _bytesToBase64(new TextEncoder().encode(str)) );
}
function base64Decode( base64:string ):string
{
  let result:string = "";
  const byte = _base64ToBytes(base64);
  result = new TextDecoder().decode(byte);
  return( result );
}
// --[ random number ]
//? 출처 : ChatGPT - "https://chat.openai.com/share/719d1610-63d5-4b10-a2da-b96ebe168479"
function getRandom53bit():number
{
  const buffer = new Uint32Array(2);
  crypto.getRandomValues(buffer);
  
  const random53Bit = (buffer[0] * 0x100000000 + buffer[1]) / (0x100000000 * 0x100000000);

  const maxInt53Bit = 9007199254740991; // 2^53 - 1
  return Math.floor(random53Bit * (maxInt53Bit + 1));
}
//? 1 ~ 2 자릿수 랜덤 아이디 생성
function getRandomIDPart():number
{
  let id:number = getRandom53bit();
  id = id - Math.floor(id/100)*100;
  return( id );
}
// --[ time ]
function getTime():number
{
  return( new Date().getTime() );
}
function calcTime( day:number, h:number, m:number, s:number ):number
{
  return( (1000*s)+(1000*60*m)+(1000*60*60*h)+(1000*60*60*24*day) );
}
// --[ etc ]
function ex( ...args:any[] ):boolean
{
  for ( const v of args )
    if ( !v ) return( true );
  return( false );
}
// --[[ export ]]
export{
  netlog,
  netclose,
  log,
  errlog,
  dbg,

  base64Encode,
  base64Decode,

  getRandom53bit,
  getRandomIDPart,

  getTime,
  calcTime,

  ex,
}