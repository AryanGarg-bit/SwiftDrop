// Cache the DOM elements we rely on so we can safely reuse them.
const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("file");
const passwordInput = document.getElementById("password");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const resultContainer = document.getElementById("result");

let uploadTotalBytes = 0;
const apiBase = window.location.origin;

function resetProgress() {
	if (progressBar) {
		progressBar.style.width = "0%";
	}
	if (progressText) {
		progressText.innerText = "Starting upload";
	}
}

function renderResult(link) {
	if (!resultContainer) {
		return;
	}

	resultContainer.innerHTML = [
		"Link:<br>",
		`<a href="${link}" target="_blank">${link}</a>`,
		"<br><br>",
		`<button onclick="copyLink('${link}')">Copy Link</button>`,
		"<br><br>",
		'<img id="qr" width="200" alt="Download QR">'
	].join("");
}

// MAIN UPLOAD FUNCTION
async function upload() {
	if (!fileInput) {
		console.error("Missing file input element");
		return;
	}

	const { files } = fileInput;
	if (!files || files.length === 0) {
		alert("Please select at least one file");
		return;
	}

	console.log("Selected files:", files);

	const formData = new FormData();
	uploadTotalBytes = 0;

	for (let index = 0; index < files.length; index += 1) {
		const currentFile = files[index];
		uploadTotalBytes += currentFile.size;
		formData.append("files", currentFile);
	}

	const password = passwordInput ? passwordInput.value : "";
	formData.append("password", password);

	const xhr = new XMLHttpRequest();
	xhr.open("POST", `${apiBase}/upload`);

	if (progressContainer) {
		progressContainer.style.display = "block";
	}
	resetProgress();

	xhr.upload.onprogress = (event) => {
		if (!progressBar || !progressText) {
			return;
		}

		const total = event.lengthComputable ? event.total : uploadTotalBytes;
		if (!total) {
			return;
		}

		const percent = Math.min(100, Math.round((event.loaded / total) * 100));
		progressBar.style.width = `${percent}%`;
		progressText.innerText = `Uploading: ${percent}%`;
	};

	xhr.onerror = () => {
		if (progressText) {
			progressText.innerText = "Upload error";
		}
	};

	xhr.onload = async () => {
		if (!progressText) {
			return;
		}

		if (xhr.status === 200) {
			let data;
			try {
				data = JSON.parse(xhr.responseText);
			} catch (error) {
				progressText.innerText = "Invalid server response";
				return;
			}

			if (!data || !data.link) {
				progressText.innerText = "Missing download link";
				return;
			}

			progressText.innerText = "Upload complete";
			renderResult(data.link);

			let id = "";
			try {
				const linkUrl = new URL(data.link, window.location.origin);
				id = linkUrl.searchParams.get("id") || "";
			} catch (error) {
				id = (data.link.split("id=")[1] || "").trim();
			}

			if (!id) {
				progressText.innerText = "Missing download identifier";
				return;
			}

			try {
				const qrRes = await fetch(`${apiBase}/qrcode/${encodeURIComponent(id)}`);
				if (!qrRes.ok) {
					throw new Error(`QR request failed: ${qrRes.status}`);
				}

				const qrData = await qrRes.json();
				if (!qrData || !qrData.qr) {
					console.error("QR not received");
					progressText.innerText = "Uploaded, but QR unavailable";
					return;
				}

				const qrImage = document.getElementById("qr");
				if (qrImage) {
					qrImage.src = qrData.qr;
				}
			} catch (error) {
				console.error("QR fetch error", error);
				progressText.innerText = "Uploaded, but QR unavailable";
			}
		} else {
			let errorMessage = "Upload failed";
			try {
				const payload = JSON.parse(xhr.responseText);
				if (payload && payload.error) {
					errorMessage = payload.error;
				}
			} catch (error) {
				// Ignore JSON parse issues and fall back to generic error.
			}

			progressText.innerText = errorMessage;
			if (resultContainer) {
				resultContainer.innerText = "";
			}
		}
	};

	xhr.send(formData);
}

async function copyLink(link) {
	try {
		await navigator.clipboard.writeText(link);
		alert("Link copied!");
	} catch (clipboardError) {
		const temp = document.createElement("input");
		temp.value = link;
		document.body.appendChild(temp);
		temp.select();
		document.execCommand("copy");
		document.body.removeChild(temp);
		alert("Link copied!");
	}
}

if (dropArea && fileInput) {
	dropArea.addEventListener("dragover", (event) => {
		event.preventDefault();
		dropArea.classList.add("dragover");
	});

	dropArea.addEventListener("dragleave", () => {
		dropArea.classList.remove("dragover");
	});

	dropArea.addEventListener("drop", (event) => {
		event.preventDefault();
		dropArea.classList.remove("dragover");

		const droppedFiles = event.dataTransfer ? event.dataTransfer.files : null;
		if (!droppedFiles || droppedFiles.length === 0) {
			return;
		}

		try {
			fileInput.files = droppedFiles;
		} catch (assignError) {
			if (typeof DataTransfer === "function") {
				const transfer = new DataTransfer();
				Array.from(droppedFiles).forEach((file) => transfer.items.add(file));
				fileInput.files = transfer.files;
			} else {
				fileInput.files = droppedFiles;
			}
		}

		console.log("Dropped files:", droppedFiles);
		upload();
	});

	dropArea.addEventListener("click", () => {
		fileInput.click();
	});
}

if (fileInput) {
	fileInput.addEventListener("change", () => {
		console.log("File input change detected:", fileInput.files);
		upload();
	});
}

window.upload = upload;
window.copyLink = copyLink;
