const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// 업로드 폴더 자동 생성
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const upload = multer({ dest: 'uploads/' });

// 1. SQLite 데이터베이스 연결 (backup.db 파일 자동 생성)
const db = new sqlite3.Database('backup.db');

// SQL: 이미지 정보를 저장할 테이블 만들기
db.run(`CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    original_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.static('public'));
// 메인 주소(/)로 들어오면 public/index.html 파일을 보내준다!
// [메인 페이지 - DB에서 제목/설명 포함하여 불러오기]
app.get('/', (req, res) => {
  const sql = `SELECT * FROM images ORDER BY id DESC`; // 최신순으로 가져오기

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB 조회 에러:', err.message);
      return res.status(500).send('데이터를 불러오지 못했습니다.');
    }

    // index.html 또는 메인 화면 렌더링에 rows 데이터를 전달
    res.render('index', { images: rows }); 
    // ※ 만약 EJS 템플릿 엔진을 쓰지 않고 HTML 파일만 보낸다면
    // EJS/HTML 템플릿 방식에 맞춰 rows를 사용하게 됩니다.
  });
});
app.use('/uploads', express.static('uploads'));

// 2. 이미지 업로드 API (SQL INSERT 활용)
// [수정된 업로드 라우트]
// [응답 씹힘 방지 - 안전한 업로드 라우트]
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('이미지 파일을 선택해 주세요!');
  }

  const title = req.body.title || '제목 없음';
  const description = req.body.description || '';
  const filename = req.file.filename;
  const originalname = req.file.originalname;

  // 🔽 originalname -> original_name 으로 수정되었습니다!
  const sql = `INSERT INTO images (filename, original_name, title, description) VALUES (?, ?, ?, ?)`;

  db.run(sql, [filename, originalname, title, description], function (err) {
    if (err) {
      console.error('DB 에러 발생:', err.message);
      return res.status(500).send('DB 저장 중 에러가 발생했습니다: ' + err.message);
    }

    console.log('🎉 업로드 성공:', title);
    res.redirect('/');
  });
});

// 3. 백업된 이미지 목록 조회 API (SQL SELECT 활용)
app.get('/api/images', (req, res) => {
  // SELECT * 로 가져오면 title과 description도 모두 포함해서 가져옵니다!
  const sql = `SELECT * FROM images ORDER BY id DESC`;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows); // 가져온 목록을 브라우저에 보내주기
  });
});

app.listen(3000, () => {
    console.log('서버 실행 중: http://localhost:3000');
});