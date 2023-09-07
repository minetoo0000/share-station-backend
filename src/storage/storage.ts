// --[[ import ]]
// -- multer
import multer from "multer";
// -- fs
import fs from "fs";
// -- crypto
import crypto from "crypto-js";
import { dbg } from "../utiles";
import mime from "mime";

// --[[ init ]]
const STORAGE_DIR = './STORAGE_DIR/';


// --[[ function ]]
// -- 폴더 생성 함수.
function directory() {
  // -- 파일 저장소 디렉토리 생성.
  if ( fs.existsSync(STORAGE_DIR) == false )
  {
    fs.mkdirSync(STORAGE_DIR);
  }
}
directory();


// --[[ multer set ]]
const disk_storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, STORAGE_DIR);
  },
  filename(req, file, callback) {
    // -- init
    const sha3 = crypto.algo.SHA3.create({ outputLength:256 });
    const data = file.stream.read();
    const word_arr = crypto.lib.WordArray.create(data);
    let hash:string;
    let file_name:string;
    // -- 값 구하기.
    sha3.update(word_arr);
    sha3.update(new Date().getTime().toString());
    // sha3.update(crypto.lib.WordArray.random(8));
    hash = sha3.finalize().toString(crypto.enc.Base64url);
    file_name = hash;
    // -- 넘기기.
    callback(null, file_name);
  },
});

const disk = multer({
  storage:disk_storage,
  fileFilter(req, file, cb) {
    if ( file.size >= 1 )
    {
      cb(null, true);
    }
    else cb(null, true);
  },
});


function getFile( storage_id:string, set_fimename:string ):File
{
  let buf;
  buf = fs.readFileSync(STORAGE_DIR+storage_id);
  return( new File([buf], set_fimename) );
}

function XXgetFile( storage_id:string ):Promise<File>
{
  // -- init
  let result;
  // -- function
  function cb( resolve:(value:File)=>void ):(err:NodeJS.ErrnoException|null, data:Buffer)=>void
  {
    return(function(err, data){
      if ( typeof(err?.errno) == 'number' )
      {
        resolve(new File([],""));
        return;
      }

      resolve(new File([data.buffer], "?"));
    });
  }
  function then( resolve:(value:File)=>void, _reject:(reason?:any)=>void )
  {
    fs.readFile(STORAGE_DIR+storage_id, cb(resolve));
  }
  // -- system
  do{
    result = new Promise<File>(then);
  }while(0);
  // -- return
  return( result );
}


export{
  disk,
  getFile,
}