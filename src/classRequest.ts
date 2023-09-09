import { QueryResult, dataobjType, dataobjMap, Code } from "./database/database";
import { ex } from "./utiles";

class ReqResult extends QueryResult{}
class DataInfo{
  data_id:number = 0;
  data_type:dataobjType = dataobjType.unknown;
  file_name:string = "";
  file_size:number = 0;
  constructor( field?:DataInfo )
  {
    if ( !field ) return;
    this.data_id = field.data_id;
    this.data_type = field.data_type;
    this.file_name = field.file_name;
    this.file_size = field.file_size;
  }
}
class JsonDataUploads extends ReqResult{
  share_id_1:number = 0;
  share_id_2:number = 0;
  data_info_list:DataInfo[] = [];
  constructor( code?:Code, field?:{ share_id_1:number, share_id_2:number, data_info_list:DataInfo[] } ){
    super(code);
    if (ex(
      code == Code.success,
      field != undefined,
    )) return;
    this.share_id_1 = field?.share_id_1!;
    this.share_id_2 = field?.share_id_2!;
    this.data_info_list = field?.data_info_list!;
  }
}
class JsonGetBroadcastID extends ReqResult{
  broadcast_id_1:number = 0;
  broadcast_id_2:number = 0;
  constructor( code?:Code, broad_id?:{id_1:number, id_2:number} )
  {
    super(code);
    if ( broad_id == undefined || code != Code.success ) return;
    this.broadcast_id_1 = broad_id.id_1;
    this.broadcast_id_2 = broad_id.id_2;
  }
}
class JsonDataSend extends ReqResult{

}
class JsonCreateShareID extends ReqResult{
  share_id_1:number = 0;
  share_id_2:number = 0;
  constructor( code?:Code, share_id?:{ id_1:number, id_2:number } )
  {
    super(code);
    if ( share_id == undefined || code != Code.success ) return;
    this.share_id_1 = share_id.id_1;
    this.share_id_2 = share_id.id_2;
  }
}
class JsonPickupList extends ReqResult{
  share_id_list:{ id_1:number, id_2:number, type:dataobjType }[] = [];
  constructor( code?:Code, share_id_list?:{ id_1:number, id_2:number, type:dataobjType }[] )
  {
    super(code);
    if ( share_id_list == undefined || code != Code.success ) return;
    this.share_id_list = share_id_list;
  }
}
class JsonGetDataInfo extends ReqResult{
  data_info_list:DataInfo[] = [];
  constructor( code?:Code, data_info_list?:DataInfo[] )
  {
    super(code);
    if ( data_info_list == undefined || code != Code.success ) return;
    this.data_info_list = data_info_list;
  }
}
class JsonGetTextData extends ReqResult{
  text:string = "";
  constructor( code?:Code, text?:string )
  {
    super(code);
    if ( text == undefined || code != Code.success ) return;
    this.text = text;
  }
}


////////////////////////////////////

function codeMsg( code:number )
{
  switch( code )
  {
    case 200:return( "success" );
    case 500:return( "backserver-blackout" );
    default:return( "unknown-error-code" );
  }
}

function newResult( code:number )
{
  let result = {
    code:200,
    msg:"success",
  }
  result.code = code;
  result.msg = codeMsg(code);
  return( result );
}

function newResultData( code:number, data:number )
{
  const tmp = newResult(code);
  
  let result = {
    code:tmp.code,
    msg:tmp.msg,
    data:data,
  };
  return( result );
}


function sendData()
{
  // ...

  return( newResult(200) );
}

function sendCode()
{
  // ....

  return( newResult(200) );
}


function sendState()
{
  if ( "참 또는 거짓..." )
  {
    return( newResult(500) );
  }
  else if ( "참 또는 거짓..." )
  {
    return( newResult(500) );
  }
  else
  {
    return( newResult(200) );
  }
}



export{
  DataInfo,
  dataobjType,
  dataobjMap,
  JsonDataUploads,
  JsonGetBroadcastID,
  JsonDataSend,
  JsonCreateShareID,
  JsonPickupList,
  JsonGetDataInfo,
  JsonGetTextData,
}