drop
database if exists sharestation;

create
database sharestation;

use sharestation;

-- 대상 데이터/클라이언트 객체.
create
table dataobj(
  -- 객체 고유 아아디.
  id bigint unsigned primary key,
  -- 객체 종류 / 데이터 종류
  -- 0:클라이언트 객체, 1:텍스트, 2:메모, 3:파일
  type tinyint not null,
  -- 생성 시간.
  created_time bigint unsigned not null,
  -- 마지막 로그인 시간/생성 시간.
  last_time bigint unsigned not null,
  -- 스토리지 파일 아이디.
  storage_id char(43) not null,
  -- 원본 파일 이름.
  file_name varchar(256) not null
);

-- 연결된 기기 관계 테이블.
create
table clientcon(
  -- 연결된 아이디.
  -- 항상 id_1이 id_2보다 크다.
  id_1 bigint unsigned not null,
  foreign key(id_1) references dataobj(id),
  id_2 bigint unsigned not null,
  foreign key(id_2) references dataobj(id),
  unique(id_1,id_2)
);

-- 대상 데이터 임시 아이디.
create
table datalink(
  -- 임시 아이디.
  id_1 tinyint unsigned not null,
  id_2 tinyint unsigned not null,
  -- dataobj 테이블의 객체 고유 아이디.
  id bigint unsigned primary key,
  foreign key(id) references dataobj(id),
  -- 생성 시간.
  create_time bigint unsigned not null
);
-- 클라이언트 수신 아이디.
create
table clientlink(
  -- dataobj 객체의 고유 아이디.
  id bigint unsigned primary key,
  foreign key(id) references dataobj(id),
  -- 수신 아이디.
  id_1 tinyint unsigned not null,
  id_2 tinyint unsigned not null,
  unique(id_1,id_2),
  -- 생성 시간.
  create_time bigint unsigned not null
);
-- 수신자의 수신함.
create
table pickup(
  -- 수신자 클라이언트 고유 아이디.
  client_id bigint unsigned not null,
  foreign key(client_id) references dataobj(id),
  -- 전달 받은 데이터의 공유 아이디.
  id_1 tinyint unsigned not null,
  id_2 tinyint unsigned not null,
  -- 동일한 데이터 전달 방지.
  unique(client_id, id_1, id_2),
  -- 생성 날짜.
  create_time bigint unsigned not null
);


-- [ 더미 데이터 ]
-- 클라이언트 레코드 생성.
insert
into dataobj
values( 1234567890, 0, 1500, 11500, "", "" );
-- 수신 아이디 생성.
insert
into clientlink
values( 1234567890, 12, 34, 20000 );

-- 클라이언트 레코드 생성 2.
insert
into dataobj
values( 9912, 0, 9000, 20000, "", "" );
-- 수신 아이디 생성 2.
insert
into clientlink
values( 9912, 56, 78, 20000 );

-- 대상 데이터 생성.
insert
into dataobj
values( 5671, 3, 29000, 29000, "1234567890123456789012345678901234567890123", "lol.jpg" );
insert
into dataobj
values( 5672, 3, 29000, 29000, "1234567890123456789012345678901234567890123", "lol.jpg" );
insert
into dataobj
values( 5673, 3, 29000, 29000, "1234567890123456789012345678901234567890123", "lol.jpg" );
-- 대상 데이터 임시 아이디 생성.
insert
into datalink
values( 10, 10, 5671, 99000 );
insert
into datalink
values( 10, 10, 5672, 99000 );
insert
into datalink
values( 10, 10, 5673, 99000 );

-- 데이터가 전달됨.
insert
into pickup
values( 1234567890, 10,10, 90000 );

-- 자주 쓰는 기기 등록.
insert
into clientcon
values( 1234567890, 9912 );


-- 5초에 한번 씩 카운트 되는 기계가 있다. 500초 동안 작동시켰더니 카운트 값이 90이다. 카운트 1회 당 몇 초의 오차가 있는가?
