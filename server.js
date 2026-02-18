const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://bxxebiztzyepjptkdpvz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4eGViaXp0enllcGpwdGtkcHZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNTY0ODAsImV4cCI6MjA4NjczMjQ4MH0.L4lGXZjUpxiqqAjZi5yuVjo10Cy-rZVYilv--qDgF0Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const QRCode = require("qrcode");

app.get("/qrcode/:id", async (req, res) => {
  const { id } = req.params;
  const link = `http://localhost:3000/file.html?id=${id}`;

  try {
    const qr = await QRCode.toDataURL(link);
    res.json({ qr });
  } catch (err) {
    console.error("QR generation error:", err);
    res.status(500).json({ error: "QR generation failed" });
  }
});


// MULTER STORAGE CONFIG
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, uuidv4() + "-" + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
}).array("files", 10);


// UPLOAD ENDPOINT (SAVES TO SUPABASE)
app.post("/upload", (req, res) => {
  upload(req, res, async (multerError) => {
    if (multerError) {
      console.error("Multer upload error", multerError);
      const statusCode = multerError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(statusCode).json({ error: multerError.message || "Upload error" });
    }

    try {
      console.log("Uploaded files:", req.files);

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const id = uuidv4();
      const password = req.body.password || "";
      const filenames = req.files.map((file) => file.filename);

      const { error } = await supabase
        .from("files")
        .insert({
          id,
          filename: JSON.stringify(filenames),
          password,
          downloads: 0
        });

      if (error) {
        console.error("Supabase insert failed", error);
        return res.status(500).json({ error: "Database error" });
      }

      res.json({
        link: `http://localhost:3000/file.html?id=${id}`
      });
    } catch (err) {
      console.error("Upload handler error", err);
      res.status(500).json({ error: "Upload failed" });
    }
  });
});


// VERIFY PASSWORD ENDPOINT
app.post("/verify", async (req, res) => {
  try {
    const { id, password } = req.body;

    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "File not found" });
    }

    if (data.password !== password) {
      return res.status(401).json({ error: "Wrong password" });
    }

    let originalName;
    try {
      const filenames = JSON.parse(data.filename);
      if (Array.isArray(filenames)) {
        originalName = filenames.length === 1
          ? filenames[0].replace(/^[^-]+-/, "")
          : `files-${id}.zip`;
      }
    } catch (parseError) {
      originalName = data.filename.replace(/^[^-]+-/, "");
    }

    if (!originalName) {
      originalName = `files-${id}.zip`;
    }

    res.json({
      download: `/download/${id}`,
      filename: originalName
    });
  } catch (err) {
    console.error("Verify handler error", err);
    res.status(500).json({ error: "Verification failed" });
  }
});


// DOWNLOAD ENDPOINT (INCREMENTS COUNTER)
app.get("/download/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "File not found" });
    }

    let filenames;
    try {
      const parsed = JSON.parse(data.filename);
      filenames = Array.isArray(parsed) ? parsed : [data.filename];
    } catch (parseError) {
      filenames = [data.filename];
    }

    const existingFiles = filenames
      .map((name) => ({
        stored: name,
        original: name.replace(/^[^-]+-/, ""),
        absolutePath: path.join(__dirname, "uploads", name)
      }))
      .filter((fileInfo) => fs.existsSync(fileInfo.absolutePath));

    if (existingFiles.length === 0) {
      return res.status(404).json({ error: "Files missing" });
    }

    res.setHeader("Cache-Control", "no-store");

    if (existingFiles.length === 1) {
      const [singleFile] = existingFiles;
      res.download(singleFile.absolutePath, singleFile.original, async (downloadError) => {
        if (downloadError) {
          console.error("Download stream error", downloadError);
          if (!res.headersSent) {
            res.status(500).json({ error: "Download failed" });
          }
          return;
        }

        const { error: updateError } = await supabase
          .from("files")
          .update({ downloads: data.downloads + 1 })
          .eq("id", id);

        if (updateError) {
          console.error("Supabase download counter update failed", updateError);
        }
      });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="files-${id}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (archiveError) => {
      console.error("Archive stream error", archiveError);
      if (!res.headersSent) {
        res.status(500).json({ error: "Archive failed" });
      }
    });

    archive.pipe(res);

    existingFiles.forEach((fileInfo) => {
      archive.file(fileInfo.absolutePath, { name: fileInfo.original });
    });

    archive.finalize().then(async () => {
      const { error: updateError } = await supabase
        .from("files")
        .update({ downloads: data.downloads + 1 })
        .eq("id", id);

      if (updateError) {
        console.error("Supabase download counter update failed", updateError);
      }
    }).catch((finalizeError) => {
      console.error("Archive finalize error", finalizeError);
    });
  } catch (err) {
    console.error("Download handler error", err);
    res.status(500).json({ error: "Download failed" });
  }
});


// FILE INFO ENDPOINT
app.get("/fileinfo/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "File not found" });
    }

    let filenames;
    try {
      const parsed = JSON.parse(data.filename);
      filenames = Array.isArray(parsed) ? parsed : [data.filename];
    } catch (parseError) {
      filenames = [data.filename];
    }

    const existingFiles = filenames
      .map((name) => ({
        stored: name,
        original: name.replace(/^[^-]+-/, ""),
        absolutePath: path.join(__dirname, "uploads", name)
      }))
      .filter((fileInfo) => fs.existsSync(fileInfo.absolutePath));

    if (existingFiles.length === 0) {
      return res.status(404).json({ error: "File missing" });
    }

    const totalSizeBytes = existingFiles.reduce((total, fileInfo) => {
      const stats = fs.statSync(fileInfo.absolutePath);
      return total + stats.size;
    }, 0);

    const displayName = existingFiles.length === 1
      ? existingFiles[0].original
      : `files-${id}.zip`;

    res.json({
      filename: displayName,
      size: (totalSizeBytes / 1024 / 1024).toFixed(2) + " MB",
      downloads: data.downloads
    });
  } catch (err) {
    console.error("File info handler error", err);
    res.status(500).json({ error: "File info failed" });
  }
});


// STATIC FILES
app.use("/uploads", express.static("uploads"));


// START SERVER
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
