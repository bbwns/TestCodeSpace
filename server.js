const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// 업로드 폴더 자동 생성
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    // ✅ 확장자가 없으면 <img> 로 표시 안 될 수 있어서 원본 확장자를 유지해 저장
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  }
});

// 1. SQLite 데이터베이스 연결 (backup.db 파일 자동 생성)
const db = new sqlite3.Database('backup.db');

// SQL: 이미지 정보를 저장할 테이블 만들기
// ✅ title, description 컬럼이 빠져 있어 INSERT 시 에러가 났던 것을 수정
db.run(`CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    original_name TEXT,
    title TEXT DEFAULT '제목 없음',
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.static('public'));
// 메인 주소(/)로 들어오면 public/index.html 파일을 보내준다!
// ✅ 기존 res.render('index', ...) 는 뷰 엔진이 없어 에러가 났음 -> sendFile 로 변경
//    (목록 렌더링은 index.html 의 fetch('/api/images') 가 담당)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.use('/uploads', express.static('uploads'));

// 상세 페이지: /image/3 으로 오면 detail.html 을 보내준다
app.get('/image/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/detail.html'));
});

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

// 상세 데이터 API: /api/images/3 으로 오면 해당 이미지 1개의 정보를 준다
app.get('/api/images/:id', (req, res) => {
  const id = req.params.id; // 주소의 :id 부분 (볼 이미지 번호)

  db.get(`SELECT * FROM images WHERE id = ?`, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }
    res.json(row); // 찾은 한 줄을 브라우저에 보내주기
  });
});

// 4. 이미지 삭제 API (파일 + DB 둘 다 삭제)
app.delete('/api/images/:id', (req, res) => {
  const id = req.params.id; // 주소의 :id 부분 (삭제할 이미지 번호)

  // ① 먼저 DB에서 해당 이미지의 파일명을 찾는다 (파일을 지우려면 이름을 알아야 하니까)
  db.get(`SELECT * FROM images WHERE id = ?`, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    // ② 실제 파일 삭제 (uploads/ 폴더에서)
    fs.unlink(path.join('uploads', row.filename), (unlinkErr) => {
      if (unlinkErr && unlinkErr.code !== 'ENOENT') {
        // ENOENT = 파일이 이미 없음. 이미 없으면 무시해도 됨
        return res.status(500).json({ error: '파일 삭제 중 오류: ' + unlinkErr.message });
      }

      // ③ DB에서 정보 삭제 (한 줄 제거)
      db.run(`DELETE FROM images WHERE id = ?`, [id], (delErr) => {
        if (delErr) {
          return res.status(500).json({ error: delErr.message });
        }
        res.json({ success: true }); // 성공 응답
      });
    });
  });
});

// 업로드 시 발생하는 에러(예: 이미지가 아닌 파일)를 안전하게 처리하는 핸들러
app.use((err, req, res, next) => {
  if (err) {
    console.error('요청 처리 중 오류:', err.message);
    return res.status(400).send(err.message || '요청 처리 중 오류가 발생했습니다.');
  }
  next();
});

app.listen(3000, () => {
    console.log('서버 실행 중: http://localhost:3000');
});
