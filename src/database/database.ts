/**
 * [ 점검 사항 ]
 *  - queryCreateBroadcastID 함수가 새 전달 아이디를 생성하는 경우, 호출이 2개 이상 동시에 발생하면서 새 랜덤 전달 아이디가 2개 이상 동일 할 때 중복된 전달 아이디가 데이터베이스에 생성될 수 있다.
 *  - queryCreateBroadcastID 함수의 인자로 전달하는 client_id는 쿼리로 따로 존재 여부를 검사하진 않는다. 이 부분은 외래키를 설정함으로서 존재하지 않는 client_id가 입력될 경우 에러를 발생시키는 방식으로 처리된다.
 *  - db.query 에 대해 await 키워드가 붙어있는지 체크!!!
 *  - querySendData 함수는 존재하지 않는 공유 아이디에 대해서도 쿼리가 성공적으로 이루어짐. ----------------- 해결 완료!
 *  - querySendData로부터 추가되는 픽업 리스트 항목의 생성 시간은 공유 아이디의 생성 시간과 동일함. 따라서 픽업리스트 항목들도 생성 시간을 기준으로 10분이 지난 픽업 항목은 지워져야 함.
 */

import "dotenv/config";
// --[[ import ]]
import mysql, { ResultSetHeader } from "mysql2/promise";
import { calcTime, dbg, ex, getRandom53bit, getRandomIDPart, getTime, log } from "../utiles";


// --[[ setting ]]
const AUTO_DELETE_TIME:5000 = 5000;
const ID_EXPIRATION_TIME:number = calcTime(0,0,10,0);
const OBJ_EXPIRATION_TIME:number = calcTime(7*3,0,0,0);
const MAX_TRY_ID_GENERATE:number = 200;
const MAX_TRY_OBJ_GENERATE:number = 10;


// --[[ init ]]
// -- query - result type
type query_t = [mysql.OkPacket | mysql.RowDataPacket[] | mysql.ResultSetHeader[] | mysql.RowDataPacket[][] | mysql.OkPacket[] | mysql.ProcedureCallPacket, mysql.FieldPacket[]];
// -- dataobj 레코드 타입.
enum dataobjType{
  unknown = -1,
  client = 0,
  text,
  memo,
  file,
}
function dataobjMap( code:dataobjType )
{
  switch ( code )
  {
    default:
    case dataobjType.unknown:return( 'unknown' );

    case dataobjType.client:return( 'client' );
    case dataobjType.text:return( 'text' );
    case dataobjType.memo:return( 'memo' );
    case dataobjType.file:return( 'file' );
  }
}
// -- dataobj
class Dataobj{
  id:number = 0;
  type:dataobjType = dataobjType.unknown;
  created_time:number = 0;
  last_time:number = 0;
  storage_id:string = "";
  file_name:string = "";
  constructor( field?:Dataobj )
  {
    if ( field == undefined ) return;
    this.id = field.id;
    this.type = field.type;
    this.created_time = field.created_time;
    this.last_time = field.last_time;
    this.storage_id = field.storage_id;
    this.file_name = field.file_name;
  }
}
// -- datalink
class Datalink{
  id_1:number = 0;
  id_2:number = 0;
  id:number = 0;
  create_time:number = 0;
  constructor( field?:Datalink )
  {
    if ( field == undefined ) return;
    this.id_1 = field.id_1;
    this.id_2 = field.id_2;
    this.id = field.id;
    this.create_time = field.create_time;
  }
}
// -- clientlink
class Clientlink{
  id:number = 0;
  id_1:number = 0;
  id_2:number = 0;
  create_time:number = 0;
  constructor( field?:Clientlink )
  {
    if ( field == undefined ) return;
    this.id = field.id;
    this.id_1 = field.id_1;
    this.id_2 = field.id_2;
    this.create_time = field.create_time;
  }
}
// -- 결과 코드.
enum Code{
  // -- 기본.
  success = 0,
  __init = 1,
  unknown_error,
  exception,
  invalid_progress,
  critical_error,
  // -- db 에러 100 ~ 199
  db_blackout = 100,
  db_query_err,
  db_query_fail,
  // -- 논리 에러 200 ~ 299
  duplication_id = 200,
  invalid_id,
  not_found,
  fail,
  already_send,
  wrong_request,
  partial_fail_or_all_fail,
  // -- http 서버 에러 300 ~ 399
  empty_files,
  empty_data,
  unknown_type,
  not_defined_client_id,
}
type Codemap = string;
function Codemap( code:Code ):Codemap
{
  switch ( code )
  {
    // -- 기본.
    default:return('error-code-'+code);
    case Code.success:return( 'success' );
    case Code.__init:return( 'dev-error' );
    case Code.unknown_error:return( 'unknown-error' );
    case Code.exception:return( 'query-exception' );
    case Code.invalid_progress:return( 'invalid-progress' );
    case Code.critical_error:return( 'critical-error' );
    // -- db 에러.
    case Code.db_blackout:return( 'db-blackout' );
    case Code.db_query_err:return( 'db-query-err' );
    case Code.db_query_fail:return( 'db-query-fail' );
    // -- 논리 에러.
    case Code.duplication_id:return( 'duplication-id' );
    case Code.invalid_id:return( 'invalid-id' );
    case Code.not_found:return( 'not-found' );
    case Code.fail:return( 'fail' );
    case Code.already_send:return( 'already-send' );
    case Code.wrong_request:return( 'wrong-request' );
    case Code.partial_fail_or_all_fail:return( 'partial-fail-or-all-fail' );
    // -- http 서버 에러.
    case Code.empty_files:return( 'empty-files' );
    case Code.empty_data:return( 'empty-data' );
    case Code.unknown_type:return( 'unknown-type' );
    case Code.not_defined_client_id:return( 'not-defined-client-id' );
  }
}
// -- 쿼리 함수 기본 클래스.
abstract class QueryResult{
  code:Code = Code.__init;
  msg:Codemap = Codemap(Code.__init);
  constructor( code?:Code )
  {
    if ( code == undefined ) return;
    this.code = code;
    this.msg = Codemap(code);
  }
}

// --[[ function ]]
// -- 쿼리 에러 처리 함수.
function queryErr( err:any ):-1
{
  log(`query error : `, err);
  return( -1 );
}
// --[ db 연결 함수 ]
let db:mysql.Connection;
let db_start_state:boolean = false;
async function connect( callback:()=>void ):Promise<mysql.Connection>
{
  log(`DB 연결중...`);
  const con = await mysql.createConnection({
    host:process.env.HOST,
    port:Number(process.env.PORT),
  
    user:process.env.USER,
    password:process.env.PASS,
  
    database:process.env.DATABASE,
  });
  db_start_state = true;
  log(`DB 연결 완료`);
  callback();
  return( db=con );
}
// --[ dataobj 객체 자동 삭제 ]
//? 최초 생성/마지막 업데이트 일시를 기준으로 일정 시간이 지난 레코드는
//? 삭제시켜준다.
class AutoObjDelete extends QueryResult{}
async function queryAutoObjDelete():Promise<AutoObjDelete>
{
  // -- init
  type r = { id:number }[];
  let result = new AutoObjDelete();
  let cut_time:number = 0;
  let delete_list:number[] = [];
  let error_check:boolean = false;
  // -- function
  //? 삭제될 아이디 리스트 가져오기 함수.
  async function getDeleteId():Promise<number[]>
  {
    // -- 3주 전 시간 구하기.
    cut_time = getTime() - OBJ_EXPIRATION_TIME;
    // -- 쿼리 - 삭제할 클라이언트 고유 아이디 가져오기.
    await db.query(`-- sql
      select id
      from ${process.env.DATABASE}.dataobj
      where last_time<=${cut_time};
    `).then(( query_result )=>{
      const parse = query_result[0] as unknown as r;
      delete_list = parse.map(( v )=>v.id);
    }).catch(queryErr);
    return( delete_list );
  }
  //? 통합 삭제 진행 함수.
  async function del( id_list:number[] ):Promise<boolean>
  {
    // -- init
    let error_check:number|0|1 = 0;
    function queryError( err: any )
    {
      queryErr(err);
      error_check = 1;
    }
    // -- 처리.
    for ( const id of id_list )
    {
      // -- 쿼리 - clientcon에서 삭제.
      //////////////////////////// 별도 에러 처리 하지 않음. 에러 없다고 가정.
      await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.clientcon
        where id_1=${id} or id_2=${id};
      `).catch(queryError);
      // -- 쿼리 - pickup에서 삭제.
      //////////////////////////// 별도 에러 처리 하지 않음. 에러 없다고 가정.
      await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.pickup
        where client_id=${id}
      `).catch(queryError);
      // -- 쿼리 - datalink에서 삭제.
      //////////////////////////// 별도 에러 처리 하지 않음. 에러 없다고 가정.
      await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.datalink
        where id=${id};
      `).catch(queryError);
      // -- 쿼리 - clientlink에서 삭제.
      //////////////////////////// 별도 에러 처리 하지 않음. 에러 없다고 가정.
      await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.clientlink
        where id=${id};
      `).catch(queryError);
      // -- 쿼리 - 최종적으로 dataobj에서 삭제.
      //////////////////////////// 별도 에러 처리 하지 않음. 에러 없다고 가정.
      await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.dataobj
        where id=${id}
      `).catch(queryError);
    }
    // -- 에러 결과 반환.
    if ( error_check == 1 ) return( true );
    else return( false );
  }
  // -- 시스템.
  do{
    // -- 예외처리.
    if ( db_start_state == false )
    {
      result = new AutoObjDelete(Code.db_blackout);
      break;
    }
    // -- 레코드 모두 지우기.
    error_check = await del(await getDeleteId());
    // -- 결과 업데이트.
    if ( error_check == false )
    {
      result = new AutoObjDelete(Code.success);
      break;
    }
    else
    {
      result = new AutoObjDelete(Code.db_query_err);
      break;
    }
  }while(0);
  // -- 결과 반환.
  return( result );
}
// --[ 클라이언트 레코드 수신 아이디 생성 ]
//? 로그인된 클라이언트에 대한 임시 아이디를 생성 및 응답.
class CreateBroadcastID extends QueryResult{
  broadcast_id_1:number = 0;
  broadcast_id_2:number = 0;
  constructor( code?:Code, id?:[number, number] )
  {
    super(code);
    //? id, code 중 하나라도 값이 제대로 채워져있지 않는 경우.
    if ( id == undefined || code != Code.success ) return;
    this.broadcast_id_1 = id[0];
    this.broadcast_id_2 = id[1];
  }
}
async function queryCreateBroadcastID( client_id:number ):Promise<CreateBroadcastID>
{
  // -- init
  let result = new CreateBroadcastID();
  let id_1:number = 0;
  let id_2:number = 0;
  let check_result:number|0|1 = 0;
  let regist_result:number|0|1 = 0;
  let state:0|1|2|-1 = -1;
  let create_time:number = getTime();
  // -- function
  //? 클라이언트 아이디가 이미 생성되어있는지 확인.
  function alreadyGeneratedCheck( qr_result:query_t ):0|1|2
  {
    type p = { id:number, id_1:number, id_2:number }[];
    const parse:p = qr_result[0]as any;

    //? 데이터 가져오기 완전 실패.
    if (ex(
      typeof parse == 'object',
      typeof parse.length == 'number',
    )) return( 0 );

    //? 다행히 중복 없음.
    else if ( parse.length == 0 ) return( 1 );

    //? 이미 생성된 아이디가 있어서 중복임.
    else if ( parse.length >= 1 )
    {
      id_1 = parse[0].id_1;
      id_2 = parse[0].id_2;
      return( 2 );
    }

    else return( 0 );
  }
  //? 수신 아이디 중복 체크 함수. 0그외:중복, 0:중복 아님.
  function generateIDChecker( query_result:query_t ):undefined
  {
    // -- init
    type r = { id_1:number, id_2:number }[];
    let parse:r;
    // -- parse
    parse = query_result[0] as any as r;
    // -- check
    check_result = parse.length;
  }
  // -- system
  do{
    // -- 예외 처리.
    if ( client_id < 0 )
    {
      result = new CreateBroadcastID(Code.exception);
      break;
    }
    // -- 이미 클라이언트 아이디가 생성되어있는지 확인.
    state = await db.query(`-- sql
      select id, id_1, id_2
      from ${process.env.DATABASE}.clientlink
      where id=${client_id}
      ;
    `).then(alreadyGeneratedCheck).catch(queryErr);
    //? 데이터 가져오기 실패.
    if ( state == 0 )
    {
      result = new CreateBroadcastID(Code.db_query_fail);
      break;
    }
    //? 이미 생성된 아이디가 있음.
    else if ( state == 2 )
    {
      //? 아이디는 이미 가져왔으므로 걱정 ㄴㄴ..
      result = new CreateBroadcastID(Code.success, [id_1, id_2]);
      break;
    }

    // -- 클라이언트 아이디가 생성되어있지 않은 상태...
    
    // -- 새로운 수신 아이디 생성 시도.
    for ( let c=MAX_TRY_ID_GENERATE; c; c-- )
    {
      // -- 수신 아이디 랜덤 생성.
      id_1 = getRandomIDPart();
      id_2 = getRandomIDPart();
      // -- 쿼리 - 수신 아이디 중복 체크.
      await db.query(`-- sql
        select id_1, id_2
        from ${process.env.DATABASE}.clientlink
        where id_1=${id_1} and id_2=${id_2}
        ;
      `).then(generateIDChecker).catch(queryErr);
      // -- 재시도 여부 검사.
      //? 중복이 아닌 경우.
      if ( check_result == 0 )
      {
        //? 시도 중단.
        break;
      }
    }
    // -- 중복 검사.
    //? 재시도 전부 중복인 경우.
    if ( check_result != 0 )
    {
      result = new CreateBroadcastID(Code.duplication_id);
      break;
    }
    // -- 최종적으로 중복이 아닌 id를 찾음...
    // -- 현재 시간 업데이트.
    create_time = getTime();
    // -- 쿼리 - 새 전송 아이디 등록.
    await db.query(`-- sql
      insert
      into ${process.env.DATABASE}.clientlink
      values( ${client_id}, ${id_1}, ${id_2}, ${create_time} )
      ;
    `).then(()=>{
      regist_result = 1;
    }).catch(queryErr);
    // -- 결과 검사.
    //? 성공 시.
    if ( regist_result == 1 )
    {
      const id:[number,number] = [id_1, id_2];
      result = new CreateBroadcastID(Code.success, id);
      break;
    }
    //? 실패 시.
    else
    {
      result = new CreateBroadcastID(Code.db_query_err);
      break;
    }
   }while(0);
  // -- return
  return( result );
}
// --[ 수신 아이디 자동 삭제 ]
class AutoBroadcastIDDelete extends QueryResult{
  constructor( code?:Code )
  {
    super(code);
  }
}
async function queryAutoBroadcastIDDelete():Promise<AutoBroadcastIDDelete>
{
  // -- init
  let result = new AutoBroadcastIDDelete();
  let cut_time:number = 0;
  let delete_check:number|0|1 = 0;
  // -- function
  function deleteCheck( query_result:query_t )
  {
    // -- 삭제 되었음 : 1
    delete_check = 1;
  }
  // -- system
  do{
    // -- 10+0.5분 전 시간 구하기.
    //? 기준은 10분이지만 통신 시간 등을 고려할 때 삭제는 1분 늦게 한다. 클라이언트에서는 10분 마다 재생성 요청을 한다.
    cut_time = getTime() - ID_EXPIRATION_TIME - calcTime(0,0,0,30);
    // -- 쿼리 - 일정 시간이 지난 수신 아이디 삭제.
    await db.query(`-- sql
      delete
      from ${process.env.DATABASE}.clientlink
      where create_time<=${cut_time}
      ;
    `).then(deleteCheck).catch(queryErr);
    // -- 삭제 여부 검사.
    //? 삭제 시도가 완료된 경우.
    if ( delete_check )
    {
      result = new AutoBroadcastIDDelete(Code.success);
      break;
    }
    //? 쿼리 오류가 발생한 경우.
    else
    {
      result = new AutoBroadcastIDDelete(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 클라이언트 로그인 ]
class Login extends QueryResult{
  is_valid:boolean = false;
  constructor( code?:Code, is_valid?:boolean )
  {
    super(code);
    if ( is_valid == undefined || code != Code.success ) return;
    this.is_valid = is_valid;
  }
}
async function queryLogin( client_id:number ):Promise<Login>
{
  // -- init
  let result = new Login();
  let current_time:number = 0;
  let match_check:number|0|1|-1 = -1;
  // -- function
  function matchCheck( query_result:query_t )
  {
    // -- init
    const parse:ResultSetHeader = query_result[0] as any;
    // -- client_id 일치 여부 확인.
    if ( parse.affectedRows == 1 ) match_check = 1;
    else match_check = 0;
  }
  // -- system
  do{
    // -- 현재 시간 구하기.
    current_time = getTime();
    // -- 쿼리 - 마지막 로그인 시간 업데이트.
    await db.query(`-- sql
      update ${process.env.DATABASE}.dataobj
      set last_time=${current_time}
      where id=${client_id}
      ;
    `).then(matchCheck).catch(queryErr);
    // -- client_id 유효성 검사.
    //? 유효함.
    if ( match_check == 1 )
    {
      result = new Login(Code.success, true);
      break;
    }
    //? 유효하지 않음.
    else if ( match_check == 0 )
    {
      result = new Login(Code.success, false);
      break;
    }
    //? 에러 발생.
    else
    {
      result = new Login(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 클라이언트 회원가입 ]
class ClientRegist extends QueryResult{
  client_id:number = 0;
  constructor( code?:Code, client_id?:number )
  {
    super(code);
    if ( client_id == undefined ) return;
    this.client_id = client_id;
  }
}
async function queryClientRegist():Promise<ClientRegist>
//? 클라이언트 레코드를 생성한다.
{
  // -- init
  let result = new ClientRegist();
  let new_client_id:number = 0;
  let create_time:number = 0;
  let query_check:number|0|1|-1 = -1;
  // -- function
  function queryCheck( query_result:query_t )
  {
    // -- init
    const parse:ResultSetHeader = query_result[0] as any;
    // -- 검사.
    if ( parse.affectedRows == 1 ) query_check = 1;
    else query_check = 0;
  }
  // -- system
  do{
    // -- 시도
    for ( let c=MAX_TRY_OBJ_GENERATE; c; c-- )
    {
      // -- 랜덤 클라이언트 고유 아이디 생성.
      new_client_id = getRandom53bit();
      // -- 생성 시간 구하기.
      create_time = getTime();
      // -- 쿼리 - 랜덤 생성된 아이디로 저장 시도.
      await db.query(`-- sql
        insert
        into ${process.env.DATABASE}.dataobj
        values( ${new_client_id}, ${dataobjType.client}, ${create_time}, ${create_time}, "", "" )
        ;
      `).then(queryCheck).catch(queryErr);
      // -- 재시도 여부 검사.
      //? 저장 잘 되었음.
      if ( query_check == 1 ) break;
    }
    // -- 쿼리 결과 검사.
    //? 잘 저장되었음.
    if ( query_check == 1 )
    {
      result = new ClientRegist(Code.success, new_client_id);
      break;
    }
    //? 말이 안되는 경우임. 쿼리 에러는 업는데 insert는 안되었다??
    //? OR
    //? 쿼리 에러 발생.
    else
    {
      result = new ClientRegist(Code.unknown_error);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 텍스트 정보 등록 ]
class CreateText extends QueryResult{
  data_id:number = 0;
  constructor( code?:Code, data_id?:number )
  {
    super(code);
    if ( data_id == undefined || code != Code.success ) return;
    this.data_id = data_id;
  }
}
async function queryCreateText( storage_id:string ):Promise<CreateText>
{
  // -- init
  let result = new CreateText();
  let new_data_id:number = 0;
  let create_time:number = 0;
  let query_check:number|0|1 = 0;
  // -- function
  function queryCheck( query_result:query_t )
  {
    // -- 기본키 에러는 없으므로 성공.
    query_check = 1;
  }
  // -- system
  do{
    // -- 시도
    for ( let c=MAX_TRY_OBJ_GENERATE; c; c-- )
    {
      // -- 새 아이디 구하기.
      new_data_id = getRandom53bit();
      // -- 현재 시간 구하기.
      create_time = getTime();
      // -- 쿼리 - 텍스트 정보 저장.
      await db.query(`-- sql
        insert
        into ${process.env.DATABASE}.dataobj
        values( ${new_data_id}, ${dataobjType.text}, ${create_time}, ${create_time}, "${storage_id}", "" )
        ;
      `).then(queryCheck).catch(queryErr);
      // -- 재시도 여부 검사.
      //? 쿼리 에러 없음.
      if ( query_check == 1 ) break;
    }
    // -- 쿼리 결과 검사.
    //? 성공.
    if ( query_check == 1 )
    {
      result = new CreateText(Code.success, new_data_id);
      break;
    }
    //? 쿼리 에러 발생.
    else
    {
      result = new CreateText(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 메모 정보 등록 ]
class CreateMemo extends QueryResult{
  data_id:number = 0;
  constructor( code?:Code, data_id?:number )
  {
    super(code);
    if ( data_id == undefined || code != Code.success ) return;
    this.data_id = data_id;
  }
}
async function queryCreateMemo( storage_id:string ):Promise<CreateMemo>
{
  // -- init
  let result = new CreateMemo();
  let new_data_id:number = 0;
  let create_time:number = 0;
  let query_check:number|0|1 = 0;
  // -- function
  function queryCheck( query_result:query_t )
  {
    // -- 기본키 에러는 없으므로 성공.
    query_check = 1;
  }
  // -- system
  do{
    // -- 시도
    for ( let c=MAX_TRY_OBJ_GENERATE; c; c-- )
    {
      // -- 새 아이디 구하기.
      new_data_id = getRandom53bit();
      // -- 현재 시간 구하기.
      create_time = getTime();
      // -- 쿼리 - 텍스트 정보 저장.
      await db.query(`-- sql
        insert
        into ${process.env.DATABASE}.dataobj
        values( ${new_data_id}, ${dataobjType.memo}, ${create_time}, ${create_time}, "${storage_id}", "" )
        ;
      `).then(queryCheck).catch(queryErr);
      // -- 재시도 여부 검사.
      //? 쿼리 에러 없음.
      if ( query_check == 1 ) break;
    }
    // -- 쿼리 결과 검사.
    //? 성공.
    if ( query_check == 1 )
    {
      result = new CreateMemo(Code.success, new_data_id);
      break;
    }
    //? 쿼리 에러 발생.
    else
    {
      result = new CreateMemo(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 파일 정보 등록 ]
class CreateFile extends QueryResult{
  data_id:number = 0;
  constructor( code?:Code, data_id?:number )
  {
    super(code);
    if ( data_id == undefined || code != Code.success ) return;
    this.data_id = data_id;
  }
}
async function queryCreateFile( storage_id:string, file_name:string ):Promise<CreateFile>
{
  // -- init
  let result = new CreateFile();
  let new_data_id:number = 0;
  let create_time:number = 0;
  let query_check:number|0|1 = 0;
  // -- function
  function queryCheck( query_result:query_t )
  {
    // -- 기본키 에러는 없으므로 성공.
    query_check = 1;
  }
  // -- system
  do{
    // -- 시도
    for ( let c=MAX_TRY_OBJ_GENERATE; c; c-- )
    {
      // -- 새 아이디 구하기.
      new_data_id = getRandom53bit();
      // -- 현재 시간 구하기.
      create_time = getTime();
      // -- 쿼리 - 텍스트 정보 저장.
      await db.query(`-- sql
        insert
        into ${process.env.DATABASE}.dataobj
        values( ${new_data_id}, ${dataobjType.file}, ${create_time}, ${create_time}, "${storage_id}", "${file_name}" )
        ;
      `).then(queryCheck).catch(queryErr);
      // -- 재시도 여부 검사.
      //? 쿼리 에러 없음.
      if ( query_check == 1 ) break;
    }
    // -- 쿼리 결과 검사.
    //? 성공.
    if ( query_check == 1 )
    {
      result = new CreateFile(Code.success, new_data_id);
      break;
    }
    //? 쿼리 에러 발생.
    else
    {
      result = new CreateFile(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 데이터 레코드 공유 아이디 생성 ]
class CreateShareID extends QueryResult{
  id_1:number = 0;
  id_2:number = 0;
  constructor( code?:Code, id?:[number, number] )
  {
    super(code);
    if ( id == undefined || code != Code.success ) return;
    this.id_1 = id[0];
    this.id_2 = id[1];
  }
}
// --[ 데이터 묶음의 공유 아이디 생성 ]
async function queryCreateShareID( data_id_list:number[] ):Promise<CreateShareID>
{
  // -- init
  let result = new CreateShareID();
  let id_1:number = 0;
  let id_2:number = 0;
  let create_time:number = 0;
  let query_check:number|0|1 = 1;
  let id_check:number|0|1|-1 = -1;
  // -- function
  function queryCheck( query_result:query_t )
  {
    // -- 기본키 에러는 없으므로 성공.
    query_check = 1;
  }
  function idCheck( query_result:query_t )
  {
    // -- init
    const parse:Dataobj = (query_result[0]as any)[0] as any;
    // -- 레코드 타입 검사.
    //? 클라이언트 레코드만 아니면 됨.
    //? 한번이라도 레코드가 아니면 계속 0.
    if ( id_check != 0 && parse.type != dataobjType.client ) id_check = 1;
    else id_check = 0;
  }
  // -- system
  do{
    for ( const data_id of data_id_list )
    {
      // -- 쿼리 - data_id가 client_id가 아닌지 검사.
      await db.query(`-- sql
        select type
        from ${process.env.DATABASE}.dataobj
        where id=${data_id}
        ;
      `).then(idCheck).catch(queryErr);
    }
    // -- 타입 검사 결과.
    //? 클라이언트 아이디임.
    if ( id_check == 0 )
    {
      result = new CreateShareID(Code.invalid_id);
      break;
    }
    //? 쿼리 에러.
    else if ( id_check == -1 )
    {
      result = new CreateShareID(Code.db_query_err);
      break;
    }
    // -- 그 외의 경우는 유효함...
    // -- 새 아이디 구하기.
    id_1 = getRandomIDPart();
    id_2 = getRandomIDPart();
    // -- 랜덤 생성된 아이디로 데이터 묶음 공유 아이디 생성.
    for ( const data_id of data_id_list )
    {
      // -- 시도
      for ( let c=MAX_TRY_ID_GENERATE; c; c-- )
      {
        // -- 현재 시간 구하기.
        create_time = getTime();
        // -- 쿼리 - 텍스트 정보 저장.
        await db.query(`-- sql
          insert
          into ${process.env.DATABASE}.datalink
          values( ${id_1}, ${id_2}, ${data_id}, ${create_time} )
          ;
        `).then(queryCheck).catch(queryErr);
        // -- 재시도 여부 검사.
        //? 쿼리 에러 없음.
        if ( query_check == 1 ) break;
      }
      // -- 쿼리 결과 검사.
      //? 끝까지 쿼리 에러 발생.
      if ( query_check == 0 )
      {
        result = new CreateShareID(Code.db_query_err);
        break;
      }
    }
    // -- 에러 없이 데이터 묶음 공유 아이디 생성됨...
    // -- 최종 결과 업데이트.
    result = new CreateShareID(Code.success, [ id_1, id_2 ]);
  }while(0);
  // -- return
  return( result );
}
// --[ 데이터의 공유 아이디 생성 ]
async function XXqueryCreateShareID( data_id:number ):Promise<CreateShareID>
{
  // -- init
  let result = new CreateShareID();
  let id_1:number = 0;
  let id_2:number = 0;
  let create_time:number = 0;
  let query_check:number|0|1 = 0;
  let id_check:number|0|1|-1 = -1;
  // -- function
  function queryCheck( query_result:query_t )
  {
    // -- 기본키 에러는 없으므로 성공.
    query_check = 1;
  }
  function idCheck( query_result:query_t )
  {
    // -- init
    const parse:Dataobj = (query_result[0]as any)[0] as any;
    // -- 레코드 타입 검사.
    //? 클라이언트 레코드만 아니면 됨.
    if ( parse.type != dataobjType.client ) id_check = 1;
    else id_check = 0;
  }
  // -- system
  do{
    // -- 쿼리 - data_id가 client_id가 아닌지 검사.
    await db.query(`-- sql
      select type
      from ${process.env.DATABASE}.dataobj
      where id=${data_id}
      ;
    `).then(idCheck).catch(queryErr);
    // -- 타입 검사 결과.
    //? 클라이언트 아이디임.
    if ( id_check == 0 )
    {
      result = new CreateShareID(Code.invalid_id);
      break;
    }
    //? 쿼리 에러.
    else if ( id_check == -1 )
    {
      result = new CreateShareID(Code.db_query_err);
      break;
    }
    // -- 그 외의 경우는 유효함...
    // -- 시도
    for ( let c=MAX_TRY_ID_GENERATE; c; c-- )
    {
      // -- 새 아이디 구하기.
      id_1 = getRandomIDPart();
      id_2 = getRandomIDPart();
      // -- 현재 시간 구하기.
      create_time = getTime();
      // -- 쿼리 - 텍스트 정보 저장.
      await db.query(`-- sql
        insert
        into ${process.env.DATABASE}.datalink
        values( ${id_1}, ${id_2}, ${data_id}, ${create_time} )
        ;
      `).then(queryCheck).catch(queryErr);
      // -- 재시도 여부 검사.
      //? 쿼리 에러 없음.
      if ( query_check == 1 ) break;
    }
    // -- 쿼리 결과 검사.
    //? 성공.
    if ( query_check == 1 )
    {
      result = new CreateShareID(Code.success, [id_1, id_2]);
      break;
    }
    //? 쿼리 에러 발생.
    else
    {
      result = new CreateShareID(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 공유 아이디 자동 삭제 ]
class AutoShareIDDelete extends QueryResult{}
async function queryAutoShareIDDelete():Promise<AutoShareIDDelete>
{
  // -- init
  let result = new AutoShareIDDelete();
  let state:0|1|-1;
  let cut_time:number = 0;
  let del_check:number|0|1 = 0;
  let delete_id_list:{ id_1:number, id_2:number }[] = [];
  let list_del_check:number|0|1|-1 = 0;
  // -- function
  function delCheck( query_result:query_t ):1
  {
    // -- 쿼리 성공.
    del_check = 1;
    return( 1 );
  }
  function findID( query_result:query_t ):0|1
  {
    // -- init
    const parse:typeof delete_id_list = query_result[0]as any;
    // -- 검사.
    //? 1개도 찾지 못함.
    if ( parse.length == 0 ) return( 0 );
    // -- 1개 이상 가져옴...
    // -- 삭제할 아이디 리스트로 가져오기.
    delete_id_list = parse;
    // -- 아이디 가져오기 성공 반환.
    return( 1 );
  }
  // -- system
  do{
    // -- 10+0.5분 전 시간 구하기.
    cut_time = getTime() - ID_EXPIRATION_TIME - calcTime(0,0,0,30);
    // -- 쿼리 - 삭제할 공유 아이디 가져오기.
    state = await db.query(`-- sql
      select id_1, id_2
      from ${process.env.DATABASE}.datalink
      where create_time<=${cut_time}
      ;
    `).then(findID).catch(queryErr);
    // -- 검사.
    //? 삭제할 공유 아이디 없음.
    if ( state == 0 )
    {
      result = new AutoShareIDDelete(Code.success);
      break;
    }
    //? 쿼리 에러.
    else if ( state == -1 )
    {
      result = new AutoShareIDDelete(Code.db_query_err);
      break;
    }
    // -- 삭제할 리스트 1개 이상 있음...
    // -- 리스트의 아이디 모두 삭제.
    for ( const id of delete_id_list )
    {
      // -- 쿼리 - pickup에서 먼저 삭제.
      state = await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.pickup
        where id_1=${id.id_1} and id_2=${id.id_2}
        ;
      `).then(delCheck).catch(queryErr);
      // -- 검사.
      //? 쿼리 에러.
      if ( state == -1 )
      {
        list_del_check = -1;
        break;
      }
      //? 삭제 시도 완료.
      else if ( state == 1 )
      {
        list_del_check = 1;
      }
    }
    // -- 삭제 결과 검사.
    //? 쿼리 에러가 발생함.
    if ( list_del_check == -1 )
    {
      result = new AutoShareIDDelete(Code.db_query_err);
      break;
    }
    //? list_del_check가 0인 경우는 삭제할 아이디가 없는데도 프로세스가 강제 진행된 것이므로 논리 에러임.
    else if ( list_del_check == 0 )
    {
      result = new AutoShareIDDelete(Code.invalid_progress);
      break;
    }
    // -- 모두 삭제 시도 되었음...
    // -- 쿼리 - datalink에서 삭제.
    del_check = 0;
    await db.query(`-- sql
      delete
      from ${process.env.DATABASE}.datalink
      where create_time<=${cut_time}
      ;
    `).then(delCheck).catch(queryErr);
    // -- 쿼리 성공 검사.
    //? 성공.
    if ( del_check == 1 )
    {
      result = new AutoShareIDDelete(Code.success);
      break;
    }
    //? 에러.
    else
    {
      result = new AutoShareIDDelete(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 데이터 고유 아이디로 정보 가져오기 ]
class GetDataInfo extends QueryResult{
  data_info = new Dataobj();
  constructor( code?:Code, data_info?:Dataobj )
  {
    super(code);
    if ( data_info == undefined || code != Code.success ) return;
    this.data_info = data_info;
  }
}
async function queryGetDatainfo( data_id:number ):Promise<GetDataInfo>
{
  // -- init
  let result = new GetDataInfo();
  let data_info:Dataobj = new Dataobj();
  let get_check:number|0|1|-1 = -1;
  // -- function
  function getCheck( query_result:query_t )
  {
    // -- init
    const parse:Dataobj = (query_result[0]as any)[0];
    // -- except
    //? 찾지 못한 경우.
    if ( parse == undefined ) get_check = 0;
    //? 찾은 경우.
    else
    {
      get_check = 1;
      data_info = parse;
    }
  }
  // -- system
  do{
    // -- 쿼리 - dataobj에서 data_id로 정보 가져오기.
    await db.query(`-- sql
      select *
      from ${process.env.DATABASE}.dataobj
      where id=${data_id} and type!=0
      ;
    `).then(getCheck).catch(queryErr);
    // -- 검사.
    //? 찾음.
    if ( get_check == 1 )
    {
      result = new GetDataInfo(Code.success, data_info);
      break;
    }
    //? 못 찾음.
    else if ( get_check == 0 )
    {
      result = new GetDataInfo(Code.not_found);
      break;
    }
    //? 쿼리 에러.
    else
    {
      result = new GetDataInfo(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 공유 아이디로 정보 가져오기 ]
//? 공유 아이디로 대상 데이터 정보 가져오기.
class GetDataInfoByShareID extends QueryResult{
  data_info_list:Dataobj[] = [];
  constructor( code?:Code, data_info_arr?:Dataobj[] )
  {
    super(code);
    if ( data_info_arr == undefined || code != Code.success ) return;
    this.data_info_list = data_info_arr;
  }
}
async function queryGetDatainfoByShareID( id_1:number, id_2:number ):Promise<GetDataInfoByShareID>
{
  // -- init
  let result = new GetDataInfoByShareID();
  let id_list:number[] = [];
  let id_list_check:number|0|1|-1 = -1;
  let data_info_list:Dataobj[] = [];
  // -- function
  function getIDList( query_result:query_t )
  {
    // -- init
    //? 공유 아이디에 해당하는 데이터는 1개 이상이다.
    const parse_arr:Datalink[] = query_result[0]as any;
    // -- 데이터 고유 아이디 리스트로 가져오기.
    id_list = parse_arr.map(( v )=>v.id);
    // -- 검사.
    //? 공유 아이디로 데이터 아이디를 1개 이상 가져온 경우.
    if ( id_list.length >= 1 ) id_list_check = 1;
    //? 공유 아이디에 해당하는 데이터 아이디가 전혀 없는 경우.
    else id_list_check = 0;
  }
  // -- system
  do{
    // -- 쿼리 - 공유 아이디로 데이터 고유 아이디 가져오기.
    await db.query(`-- sql
      select id
      from ${process.env.DATABASE}.datalink
      where id_1=${id_1} and id_2=${id_2}
      ;
    `).then(getIDList).catch(queryErr);
    // -- 검사.
    //? 공유 아이디에 해당하는 데이터 고유 아이디가 없는 경우.
    if ( id_list_check == 0 )
    {
      result = new GetDataInfoByShareID(Code.not_found);
      break;
    }
    //? 쿼리 에러
    else if ( id_list_check == -1 )
    {
      result = new GetDataInfoByShareID(Code.db_query_err);
      break;
    }
    // -- 데이터 고유 아이디를 찾음...
    // -- 데이터 고유 아이디로 데이터 정보 가져오기.
    for ( let id of id_list )
    {
      // -- 데이터 정보 가져오기.
      const data_info = await queryGetDatainfo(id);
      // -- 검사.
      //? 에러인 경우 건너뛰기.
      if ( data_info.code != 0 ) continue;
      // -- 리스트에 데이터 정보 객체 push.
      data_info_list.push(data_info.data_info);
    }
    // -- 결과 업데이트.
    result = new GetDataInfoByShareID(Code.success, data_info_list);
  }while(0);
  // -- return
  return( result );
}
// --[ 데이터 레코드 삭제 ]
class DeleteData extends QueryResult{}
async function queryDeleteData( data_id:number ):Promise<DeleteData>
{
  // -- init
  let result = new DeleteData();
  let del_check:number|0|1|-1 = -1;
  // -- function
  function delCheck( query_result:query_t )
  {
    // -- init
    const parse:ResultSetHeader = query_result[0]as any;
    // -- 삭제 여부 검사.
    //? 1개 삭제됨. 무조건 한개여야 함.
    if ( parse.affectedRows == 1 ) del_check = 1;
    //? 삭제되지 않음.
    else del_check = 0;
  }
  // -- system
  do{
    // -- 쿼리 - datalink에서 삭제.
    await db.query(`-- sql
      delete
      from ${process.env.DATABASE}.datalink
      where id=${data_id}
      ;
    `).then(delCheck).catch(queryErr);
    // -- 검사.
    //? 쿼리 에러.
    //? 쿼리 에러만 발생하지 않으면 됨.
    if ( del_check == -1 )
    {
      result = new DeleteData(Code.db_query_err);
      break;
    }
    // -- 처리 함수 초기화.
    del_check = -1;
    // -- datalink 테이블에서 삭제되었거나 삭제할 것이 없음...
    //? 이제 dataobj에서 삭제하면 됨.
    // -- 쿼리 - dataobj에서 삭제.
    await db.query(`-- sql
      delete
      from ${process.env.DATABASE}.dataobj
      where id=${data_id} and type!=${dataobjType.client}
      ;
    `).then(delCheck).catch(queryErr);
    // -- 검사.
    //? 1개 삭제됨.
    if ( del_check == 1 )
    {
      result = new DeleteData(Code.success);
      break;
    }
    //? 삭제할 것이 없음.
    else if ( del_check == 0 )
    {
      result = new DeleteData(Code.not_found);
      break;
    }
    //? 쿼리 에러.
    else
    {
      result = new DeleteData(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 수신 아이디로 수신자 클라이언트 고유 아이디 가져오기 ]
class GetClientIDByBroadcastID extends QueryResult{
  client_id:number = 0;
  constructor( code?:Code, client_id?:number )
  {
    super(code);
    if ( client_id == undefined || code != Code.success ) return;
    this.client_id = client_id;
  }
}
async function queryGetClientIDByBroadcastID( id_1:number, id_2:number ):Promise<GetClientIDByBroadcastID>
{
  // -- init
  let result = new GetClientIDByBroadcastID();
  let find_client_id:number = 0;
  let find_id_check:number|0|1|-1 = -1;
  // -- function
  function findID( query_result:query_t )
  {
    // -- init
    const parse:Clientlink = (query_result[0]as any)[0];
    // -- 검사.
    //? 찾은 경우.
    if ( parse )
    {
      find_id_check = 1;
      find_client_id = parse.id;
    }
    //? 못 찾은 경우.
    else if ( parse == undefined ) find_id_check = 0;
  }
  // -- system
  do{
    // -- 쿼리 - 수신 아이디로 클라이언트 고유 아이디 가져오기.
    await db.query(`-- sql
      select id
      from ${process.env.DATABASE}.clientlink
      where id_1=${id_1} and id_2=${id_2}
      ;
    `).then(findID).catch(queryErr);
    // -- 검사.
    //? 찾은 경우.
    if ( find_id_check == 1 )
    {
      result = new GetClientIDByBroadcastID(Code.success, find_client_id);
      break;
    }
    //? 못 찾은 경우.
    else if ( find_id_check == 0 )
    {
      result = new GetClientIDByBroadcastID(Code.not_found);
      break;
    }
    //? 쿼리 에러.
    else
    {
      result = new GetClientIDByBroadcastID(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 수신 아이디를 통해 데이터를 수신자에게 전달 ]
class SendData extends QueryResult{}
async function querySendData( broadcast_id_1:number, broadcast_id_2:number, share_id_1:number, share_id_2:number ):Promise<SendData>
{
  // -- init
  let result = new SendData();
  let qr_result;
  let query_state:0|1|-1;
  let receiver_client_id:number = 0;
  let create_time:number = 0;
  // -- function
  function pickupCheck( query_result:query_t ):0|1
  {
    // -- init
    const parse:ResultSetHeader = query_result[0]as any;
    // -- 적용 검사.
    //? 저장된 경우.
    if ( parse.affectedRows == 1 ) return( 1 );
    //? 저장되지 않음.
    else return( 0 );
  }
  function dupCheck( query_result:query_t ):0|1
  {
    // -- init
    const parse = query_result[0] as any[];
    // -- 검사.
    //? 중복 아님.
    if ( parse.length == 0 ) return( 1 );
    //? 중복임.
    else return( 0 );
  }
  // -- system
  do{
    // -- 수신 아이디로 수신자의 클라이언트 고유 아이디 가져오기.
    {
      const query_result = await queryGetClientIDByBroadcastID(broadcast_id_1, broadcast_id_2);
      // -- 검사.
      //? 에러인 경우.
      if ( query_result.code != 0 )
      {
        result = new SendData(Code.db_query_err);
        break;
      }
      // -- 수신자 클라이언트 아이디 가져오기.
      receiver_client_id = query_result.client_id;
    }
    // -- 쿼리 - 중복 전달 검사.
    query_state = await db.query(`-- sql
      select null
      from ${process.env.DATABASE}.pickup
      where client_id=${receiver_client_id} and id_1=${share_id_1} and id_2=${share_id_2}
      ;
    `).then(dupCheck).catch(queryErr);
    // -- 검사.
    //? 중복임.
    if ( query_state == 0 )
    {
      result = new SendData(Code.already_send);
      break;
    }
    //? 쿼리 에러.
    else if ( query_state == -1 )
    {
      result = new SendData(Code.db_query_err);
      break;
    }
    // -- 중복 아님이 확인됨...

    // -- 공유 아이디의 생성 시간 구하기.
    qr_result = await queryGetDatainfoByShareID(share_id_1, share_id_2);
    //? 에러.
    if ( qr_result.code != Code.success )
    {
      result = new SendData(qr_result.code);
      break;
    }
    //? 가져오기 성공, 다만 리스트 길이가 0.
    else if ( qr_result.data_info_list.length == 0 )
    {
      result = new SendData(Code.not_found);
      break;
    }
    // -- 시간 가져오기.
    create_time = qr_result.data_info_list[0].created_time;

    // -- 에러 없이 클라이언트 아이디를 가져옴...

    // -- 쿼리 - 수신자의 클라이언트 아이디를 통해 데이터 공유 아이디를 수신자에게 전달.
    query_state = await db.query(`-- sql
      insert
      into ${process.env.DATABASE}.pickup
      values( ${receiver_client_id}, ${share_id_1}, ${share_id_2}, ${create_time} )
      ;
    `).then(pickupCheck).catch(queryErr);
    // -- 검사.
    //? 데이터 전달 성공.
    if ( query_state == 1 )
    {
      result = new SendData(Code.success);
      break;
    }
    //? 데이터 전달 안됨.
    else if ( query_state == 0 )
    {
      result = new SendData(Code.fail);
      break;
    }
    //? 쿼리 에러.
    else
    {
      result = new SendData(Code.db_query_err);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ 수신자의 클라이언트 아이디로 온 데이터 공유 아이디 리스트 가져오기 ]
class GetMyPickupList extends QueryResult{
  share_id_list:{ id_1:number, id_2:number, type:dataobjType }[] = [];
  constructor( code?:Code, share_id_list?:{ id_1:number, id_2:number, type:dataobjType }[] )
  {
    super(code);
    if ( share_id_list == undefined || code != Code.success ) return;
    this.share_id_list = share_id_list;
  }
}
async function queryGetMyPickupList( client_id:number ):Promise<GetMyPickupList>
{
  // -- init
  let result = new GetMyPickupList();
  let state:0|1|-1 = -1;
  let share_id_list:{ id_1:number, id_2:number }[] = [];
  let data_info_list:dataobjType[] = [];
  // -- function
  function getShareIDList( query_result:query_t ):0|1
  {
    // -- init
    const parse:typeof share_id_list = query_result[0]as any;
    // -- 검사.
    //? 1개 이상 있는 경우.
    if ( parse.length >= 1 )
    {
      share_id_list = parse;
      return( 1 );
    }
    //? 없는 경우.
    else return( 0 );
  }
  async function getDataInfo()
  {
    for ( const id of share_id_list )
    {
      const qr_result = await queryGetDatainfoByShareID(id.id_1, id.id_2);
      //? 실패한 경우.
      if ( qr_result.code != Code.success )
      {
        data_info_list.push(dataobjType.unknown);
        continue;
      }
      //? 일단은 파일은 파일 끼리 묶이므로 첫번째 데이터만 보고 전체 타입 확정.
      data_info_list.push(qr_result.data_info_list[0].type);
    }
  }
  // -- system
  do{
    // -- 쿼리 - 클라이언트 고유 아이디로 받은 공유 아이디 리스트 가져오기.
    state = await db.query(`-- sql
      select id_1, id_2
      from ${process.env.DATABASE}.pickup
      where client_id=${client_id}
      ;
    `).then(getShareIDList).catch(queryErr);
    // -- 검사.
    //? 오류인 경우.npm 
    if ( state == -1 )
    {
      result = new GetMyPickupList(Code.db_query_err);
      break;
    }

    // -- 공유 아이디로 해당 데이터의 정보 가져오기.
    await getDataInfo();
    // -- 성공적인 절차...
    // -- 데이터 재구성.
    result = new GetMyPickupList(
      Code.success,
      share_id_list.map(( v, i )=>({...v, type:data_info_list[i]}))
    );


    // //? 0개 이상 가져온 경우.
    // if ( state == 1 || state == 0 )
    // {
    //   result = new GetMyPickupList(Code.success, share_id_list);
    //   break;
    // }
    // //? 쿼리 에러.
    // else
    // {
    //   result = new GetMyPickupList(Code.db_query_err);
    //   break;
    // }
    
  }while(0);
  // -- return
  return( result );
}
// --[ 클라이언트 수신함 항목 삭제 ]
class DeleteMyPickupItem extends QueryResult{}
async function queryDeleteMyPickupItem( client_id:number, id_list:{ id_1:number, id_2:number }[] ):Promise<DeleteMyPickupItem>
{
  // -- init
  let result = new DeleteMyPickupItem();
  let state:0|1|-1 = -1;
  let del_check:0|1 = 1;
  // -- function
  function delCheck( query_result:query_t ):1
  {
    // -- init
    const parse:ResultSetHeader = query_result[0]as any;
    // -- 검사.
    //? del_check가 init, 삭제됨 상태인 경우에만 삭제 여부 변경 가능.
    //? 즉, 삭제가 한번이라도 안되었다면 변경할 수 없음.
    if ( del_check == 0 )0;
    //? 삭제 됨.
    else if ( parse.affectedRows == 1 ) del_check = 1;
    //? 삭제 안됨.
    else del_check = 0;
    // -- 쿼리 에러 없음.
    return( 1 );
  }
  // -- system
  do{
    // -- 예외처리.
    //? 삭제할 수신함 항목이 없는 경우.
    if ( id_list.length == 0 )
    {
      result = new DeleteMyPickupItem(Code.wrong_request);
      break;
    }
    // -- 아이디 리스트 처리.
    for ( const { id_1,id_2 } of id_list )
    {
      // -- 쿼리 - 클라이언트가 받은 데이터 공유 아이디 특정 항목 삭제.
      state = await db.query(`-- sql
        delete
        from ${process.env.DATABASE}.pickup
        where client_id=${client_id} and id_1=${id_1} and id_2=${id_2}
        ;
      `).then(delCheck).catch(queryErr);
      // -- 검사.
      //? 쿼리 에러 있다면 삭제 실패 처리.
      if ( state == -1 ) del_check = 0;
    }
    // -- 검사.
    //? 1개 이상 실패한 경우.
    if ( del_check == 0 )
    {
      result = new DeleteMyPickupItem(Code.partial_fail_or_all_fail);
      break;
    }
    //? 성공한 경우.
    else
    {
      result = new DeleteMyPickupItem(Code.success);
      break;
    }
  }while(0);
  // -- return
  return( result );
}
// --[ error ]
class CustomError extends QueryResult{}
const criticalError = new CustomError(Code.critical_error);
// --[[ export ]]
export{
  connect,
  queryAutoObjDelete,
  queryCreateBroadcastID,
  queryAutoBroadcastIDDelete,
  queryLogin,
  queryClientRegist,
  queryCreateText,
  queryCreateMemo,
  queryCreateFile,
  queryCreateShareID,
  queryAutoShareIDDelete,
  queryGetDatainfo,
  queryGetDatainfoByShareID,
  queryDeleteData,
  queryGetClientIDByBroadcastID,
  querySendData,
  queryGetMyPickupList,
  queryDeleteMyPickupItem,
  criticalError,
  Code,
  QueryResult,
  dataobjType,
  dataobjMap,
  CreateFile,
  AUTO_DELETE_TIME,
};
