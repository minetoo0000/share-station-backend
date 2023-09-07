// --[ import ]
import express, { NextFunction, Request, Response } from 'express';
const app = express();
import cookieParser from "cookie-parser";
import { disk, getFile } from './storage/storage';
import { base64Decode, calcTime, dbg, errlog, ex, getRandom53bit, getRandomIDPart, log, netclose, netlog } from './utiles';
import {
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
} from './database/database';
import { DataInfo, JsonCreateShareID, JsonDataSend, JsonDataUploads, JsonGetBroadcastID, JsonGetDataInfo, JsonPickupList } from './classRequest';


// --[[ init ]]
app.use(cookieParser());
app.use(express.json());
const PORT:number = 2520;
const HOSTNAME:string = "0.0.0.0";


// --[[ function ]]
// -- 헤더에서 데이터의 타입 정보 가져오기.
function getDataType( req:Request ):dataobjType
{
  function isNAN( numeric:number ):boolean
  {
    return( numeric!=numeric?true:false );
  }
  const get = Number(req.get("x-sharestation-data-type"));
  if ( isNAN(get) )
  {
    return( dataobjType.unknown );
  }
  else if (
    get != dataobjType.text &&
    get != dataobjType.memo &&
    get != dataobjType.file
  )
  {
    return( dataobjType.unknown );
  }
  
  return( get );
}

// -- 데이터베이스에 정보 저장.
class SaveDatabase extends QueryResult{
  success:boolean = false;
  data_id:number = 0;
  constructor( code?:Code, data_id?:number )
  {
    super(code);
    if (ex(
      code != undefined,
      data_id != undefined,
    )) return;
    this.success = code!==Code.success?true:false;
    this.data_id = data_id!;
  }
}
async function $saveDatabase( type:dataobjType, file:Express.Multer.File ):Promise<SaveDatabase>
{
  // -- init
  let result = new SaveDatabase();
  // -- function
  // -- system
  do{ 
    // -- 타입 구별.
    if ( type == dataobjType.text )
    {
      const qr_result = await queryCreateText(file.filename);
      result = new SaveDatabase(qr_result.code, qr_result.data_id);
    }
    else if ( type == dataobjType.memo )
    {
      const qr_result = await queryCreateMemo(file.filename);
      result = new SaveDatabase(qr_result.code, qr_result.data_id);
    }
    else if ( type == dataobjType.file )
    {
      const qr_result = await queryCreateFile(file.filename, file.originalname);
      result = new SaveDatabase(qr_result.code, qr_result.data_id);
    }
    else
    {
      result = new SaveDatabase(Code.unknown_type);
      break;
    }
  }while(0);
  // -- return
  return( result );
}



// --[[ on ]]
app.listen(PORT, HOSTNAME, async()=>{
    log(`포트 ${PORT} 개방됨`);
    // -- db 연결.
    await connect();
});


// --[ 자동 회원가입/로그인/갱신 ]
async function autoLogin( req:Request, res:Response, next:NextFunction )
{
  // -- init
  const cookie:{ client_id?:number } = req.cookies;
  let result:any = undefined;
  // -- function
  function setClientID( client_id:number )
  {
    res.cookie("client_id", client_id, { httpOnly:true, sameSite:"strict", path:"/", maxAge:calcTime(365*10,0,0,0) });
  }
  async function regist():Promise<0|1>
  {
    const query_result = await queryClientRegist();
    ////////////////////////////////
    dbg(`클라이언트 등록`, query_result);
    // -- 쿼리 검사.
    //? 에러.
    if ( query_result.code != 0 )
    {
      result = query_result;
      return( 0 );
    }
    // -- 에러 없음...
    // -- 쿠키 설정.
    setClientID(query_result.client_id);
    return( 1 );
  }
  // -- system
  do{
    // -- 쿠키 검사.
    //? 등록되지 않은 클라이언트인 경우.
    if ( cookie.client_id == undefined )
    {
      if ( await regist() == 0 ) break;
    }
    //? 쿠키가 이미 설정되어있는 경우.
    else
    {
      // -- 로그인/갱신.
      const query_result = await queryLogin(cookie.client_id);
      ///////////////////////////
      dbg(`로그인 갱신`, query_result);
      // -- 아이디 유효성 검사.
      //? 유효하지 않음.
      if ( query_result.is_valid == false )
      {
        if ( await regist() == 0 ) break;
      }
      // -- 유효함...
      // -- 쿠키 갱신.
      setClientID(cookie.client_id);
    }
  }while(0);
  // -- 최종 에러 검사.
  //? 에러 발생.
  if ( result != undefined )
  {
    dbg(`cretical 데어 발생:`, criticalError);
    res.send(criticalError);
  }
  //? 에러 아님.
  else
  {
    // -- 절차 계속.
    next();
  }
};
//. 로그인회원가입.


// --[[ response ]]
// --[ cors ]
app.use(( req,res,next )=>{
  // -- cors 설정.
  dbg(`origin:`, req.get("Origin"));
  res.header({
    "Access-Control-Allow-Origin":req.get("Origin"),
    "Access-Control-Allow-Headers":`x-sharestation-data-type,content-type`,
    'Access-Control-Allow-Credentials':true,
  });
  next();
});
// --[ 자동 로그인/회원가입 ]
app.post("/*", autoLogin);
app.get("/*", autoLogin);
// --[ 클라이언트의 수신 아이디 생성 ]
app.get("/get-broadcast-id", async( req,res )=>{
  // -- init
  let result = new JsonGetBroadcastID();
  let qr_result;
  const client_id:number = req.cookies.client_id;
  // -- function
  // -- system
  do{
    qr_result = await queryCreateBroadcastID(client_id);
    if ( qr_result.code == Code.success )
    {
      result = new JsonGetBroadcastID(Code.success, { id_1:qr_result.broadcast_id_1, id_2:qr_result.broadcast_id_2 });
      break;
    }
    else
    {
      result = new JsonGetBroadcastID(qr_result.code);
      break;
    }
  }while(0);
  // --return
  res.json(result);
});
// --[ 데이터 고유 아이디로 데이터 정보 가져오기 + 데이터 존재 여부 확인 ]
// -- 데이터
//? post 메소드임.
app.post("/get-data-info", async( req,res )=>{
  netlog(`/get-data-info`);
  // -- init
  let result = new JsonGetDataInfo();
  let qr_result;
  let conv_data_info_list;
  const json:{
    code_1:number,
    code_2:number
  } = req.body;
  // -- function
  // -- system
  do{
    if (ex(
      typeof(json) == 'object',
      json?.code_1 >= 0,
      json?.code_2 >= 0,
    ))
    {
      result = new JsonGetDataInfo(Code.wrong_request);
      break;
    }
    
    qr_result = await queryGetDatainfoByShareID(json.code_1, json.code_2);
    conv_data_info_list = qr_result.data_info_list.map(( v )=>{
      return(new DataInfo({
        data_id:v.id,
        data_type:v.type,
        file_name:v.file_name,
        file_size:-1,
      }));
    });
    result = new JsonGetDataInfo(qr_result.code, conv_data_info_list);
  }while(0);
  // -- return
  res.json(result);
  netclose(`/get-data-info`);
});
// --[ 데이터 공유 아이디로 데이터 받아내기 ]
// -- 요점은 텍스트 데이터와 파일 데이터 둘 다 지원해야한다.
app.post("/get-data", async( req,res )=>{
  netlog("/get-data");
  // -- init
  let qr_result;
  // -- function
  // -- system
  do{}while(0);
  // -- return
  ////////////////////////// 다운로드 구현 필요!!!!
  // res.download();
  netclose("/get-data");
});
// --[ 데이터의 고유 아이디로 공유 아이디 생성 ]
app.post("/create-share-id", async( req,res )=>{
  // -- init
  let result = new JsonCreateShareID();
  let qr_result;
  const json:{
    data_id:number,
  } = req.body;
  // -- function
  function checkReq()
  {
    return(ex(
      json,
      typeof json?.data_id == 'number',
    ));
  }
  // -- system
  do{
    if ( checkReq() )
    {
      result = new JsonCreateShareID(Code.wrong_request);
      break;
    }

    qr_result = await queryCreateShareID([json.data_id]);
    result = new JsonCreateShareID(qr_result.code, {
      id_1:qr_result.id_1,
      id_2:qr_result.id_2,
    });
  }while(0);
  // -- return
  res.json(result);
});
// --[ 데이터 업로드 - 텍스트/메모/파일 ]
//? 업로드된 데이터의 고유 아이디 리스트와 그 리스트에z 해당하는 공유 아이디와 각 데이터의 정보까지 전송.
app.post("/data-uploads", disk.array("uploads"), async( req,res )=>{
  netlog("/data-uploads : uploads");
  // -- init
  let result = new JsonDataUploads();
  let qr_result;
  let data_id:number = 0;
  const data_id_list:number[] = [];
  const data_type:dataobjType = getDataType(req);
  const files:Express.Multer.File[]|undefined = req.files as any;
  const share_result:{
    share_id_1:number,
    share_id_2:number,
    data_info_list:DataInfo[],
  } = {
    share_id_1:0,
    share_id_2:0,
    data_info_list:[],
  };
  // -- function
  // -- system
  do{
    // -- 예외처리.
    if (ex(
      files,
      files != undefined,
      files!.length >= 1,
    ))
    {
      result = new JsonDataUploads(Code.empty_files);
      break;
    }
    else if (ex(
      dataobjMap(data_type) != 'unknown'
    ))
    {
      result = new JsonDataUploads(Code.unknown_type);
      break;
    }

    for ( const file of files! )
    {
      if (ex(
        file,
        file.size >= 1,
      ))
      {
        result = new JsonDataUploads(Code.empty_files);
        break;
      }

      // -- 데이터 정보 저장하기.
      qr_result = await $saveDatabase(data_type, file);
      data_id = qr_result.data_id;
      //? 검사
      if ( qr_result.code != Code.success )
      {
        result = new JsonDataUploads(qr_result.code);
        break;
      }
      // -- 저장 완료됨...
      
      // -- 데이터의 아이디 리스트에 저장.
      data_id_list.push(data_id);
      // -- 결과에 미리 저장.
      share_result.data_info_list.push(
        new DataInfo({
          data_id,
          data_type,
          file_name:file.originalname,
          file_size:file.size,
        })
      );
    }
    // -- 공유 아이디 발급.
    qr_result = await queryCreateShareID(data_id_list);
    share_result.share_id_1 = qr_result.id_1;
    share_result.share_id_2 = qr_result.id_2;
    //? 검사.
    if ( qr_result.code != Code.success )
    {
      result = new JsonDataUploads(qr_result.code);
      break;
    }
    
    // -- 결과 업데이트.
    result = new JsonDataUploads(Code.success, share_result);
  }while(0);
  // -- return
  res.json(result);
  netclose("/data-uploads : uploads");
});
// --[ 수신자에게 데이터 전달하기 ]
app.post("/send-data", async( req,res )=>{
  netlog(`/send-data`);
  // -- init
  let result = new JsonDataSend();
  let qr_result;
  const json:{
    broadcast_id_1:number,
    broadcast_id_2:number,
    share_id_1:number,
    share_id_2:number,
  } = req.body;
  // -- function
  function checkRes():boolean
  {
    return(
      ex(
        json,
        json?.broadcast_id_1 != undefined,
        json?.broadcast_id_2 != undefined,
        json?.share_id_1 != undefined,
        json?.share_id_2 != undefined,
      )
    );
  }
  // -- system
  do{
    if ( checkRes() )
    {
      result = new JsonDataSend(Code.wrong_request);
      break;
    }

    qr_result = await querySendData(
      json.broadcast_id_1,
      json.broadcast_id_2,
      json.share_id_1,
      json.share_id_2,
    );
    if ( qr_result.code != Code.success )
    {
      result = new JsonDataSend(qr_result.code);
      break;
    }

    result = new JsonDataSend(Code.success);
  }while(0);
  // -- return
  res.json(result);
  netclose(`/send-data`);
});
// --[ 브로드캐스트의 수신함 리스트 가져오기 ]
app.get("/get-pickup-list", async( req,res )=>{
  // -- init
  let result = new JsonPickupList();
  let qr_result;
  const client_id:number = req.cookies.client_id;
  // -- function
  // -- system
  do{
    qr_result = await queryGetMyPickupList(client_id);
    result = new JsonPickupList(qr_result.code, qr_result.share_id_list);
  }while(0);
  // -- return
  res.json(result);
});
// --[ 브로드캐스트의 수신함의 항목 비우기 ]


// --[ system ]
// -- 자동 삭제
//? dataobj, datalink, clientlink 테이블 레코드 자동 삭제.
const ID_remove_dataobj = setInterval(
  async()=>{
    const result_0 = await queryAutoObjDelete();
    const result_1 = await queryAutoBroadcastIDDelete();
    const result_2 = await queryAutoShareIDDelete();
    if (ex(
      result_0.code == Code.success,
      result_1.code == Code.success,
      result_2.code == Code.success,
    ))
    {
      errlog(`result_0 : `, result_0);
      errlog(`result_1 : `, result_1);
      errlog(`result_2 : `, result_2);
    }
  },
  calcTime(0,0,0,5)
);
