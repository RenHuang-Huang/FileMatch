
        document.addEventListener('DOMContentLoaded', () => {
            const txtFileInput = document.getElementById('txtFile');
            const excelFileInput = document.getElementById('excelFile');
            const compareBtn = document.getElementById('compareBtn');
            const viewTxtDataBtn = document.getElementById('viewTxtDataBtn');
            const viewExcelDataBtn = document.getElementById('viewExcelDataBtn');
            const printResultsBtn = document.getElementById('printResultsBtn');
            const unhideAllBtn = document.getElementById('unhideAllBtn'); // 新增按鈕變數
            const txtMissingInExcelTableBody = document.querySelector('#txtMissingInExcel tbody');
            const excelMissingInTxtTableBody = document.querySelector('#excelMissingInTxt tbody');
            const resultsSection = document.querySelector('.results-section');

            const hideZeroTxtAmountCheckbox = document.getElementById('hideZeroTxtAmount');
            const hideZeroExcelAmountCheckbox = document.getElementById('hideZeroExcelAmount');

            const txtReadCountSpan = document.getElementById('txtReadCount');
            const excelReadCountSpan = document.getElementById('excelReadCount');

            const dataModal = document.getElementById('dataModal');
            const closeButton = document.querySelector('.close-button');
            const modalTitle = document.getElementById('modalTitle');
            const parsedDataDisplay = document.getElementById('parsedDataDisplay');

            let parsedTxtRecords = [];
            let parsedExcelRecords = [];

            compareBtn.addEventListener('click', compareFiles);
            viewTxtDataBtn.addEventListener('click', () => displayParsedData(parsedTxtRecords, 'TXT 解析結果'));
            viewExcelDataBtn.addEventListener('click', () => displayParsedData(parsedExcelRecords, 'Excel 解析結果'));
            printResultsBtn.addEventListener('click', printResults);
            unhideAllBtn.addEventListener('click', unhideAllRows); // 新增事件監聽器
            closeButton.addEventListener('click', () => {
                dataModal.style.display = 'none';
            });
            window.addEventListener('click', (event) => {
                if (event.target === dataModal) {
                    dataModal.style.display = 'none';
                }
            });

            // 為隱藏金額為0的勾選框添加事件監聽器
            hideZeroTxtAmountCheckbox.addEventListener('change', () => toggleRowsVisibility(txtMissingInExcelTableBody, hideZeroTxtAmountCheckbox.checked, 'amount'));
            hideZeroExcelAmountCheckbox.addEventListener('change', () => toggleRowsVisibility(excelMissingInTxtTableBody, hideZeroExcelAmountCheckbox.checked, 'amount'));

            txtFileInput.addEventListener('change', checkFilesAndEnableButton);
            excelFileInput.addEventListener('change', checkFilesAndEnableButton);

            /**
             * 檢查兩個檔案輸入框是否都有檔案，並啟用/禁用比對按鈕。
             */
            function checkFilesAndEnableButton() {
                if (txtFileInput.files[0] && excelFileInput.files[0]) {
                    compareBtn.disabled = false;
                    compareBtn.classList.add('highlight-button');
                } else {
                    compareBtn.disabled = true;
                    compareBtn.classList.remove('highlight-button');
                }
            }

            /**
             * 判斷字符是否為全形字符。
             * 全形字符通常在終端或固定寬度字體中佔用兩個半形字符的空間。
             * @param {string} char - 要判斷的字符。
             * @returns {boolean} 如果是全形字符則返回 true，否則返回 false。
             */
            function isFullWidth(char) {
                const code = char.charCodeAt(0);
                // 判斷常見的全形字符範圍，例如中日韓文字符
                return code > 255; // 中文、日文等視為全形字
            }

            /**
             * 為 String 原型添加一個方法，根據視覺寬度截取字串。
             * 全形字符佔用 2 個視覺寬度，半形字符佔用 1 個視覺寬度。
             * @param {number} startVisual - 視覺起始位置（從 0 開始）。
             * @param {number} lengthVisual - 要截取的視覺長度。
             * @returns {string} 截取後的字串。
             */
            String.prototype.substrByVisualWidth = function(startVisual, lengthVisual) {
                let result = '';
                let currentVisualWidth = 0;
                let charIndex = 0;
                const str = this;

                while (charIndex < str.length) {
                    const char = str[charIndex];
                    const charWidth = isFullWidth(char) ? 2 : 1;

                    // 如果當前字符的視覺寬度加上已累積的寬度超過了目標結束位置，則停止
                    if (currentVisualWidth + charWidth > startVisual + lengthVisual) {
                        break;
                    }

                    // 如果已累積的寬度達到或超過起始位置，則將字符添加到結果中
                    if (currentVisualWidth >= startVisual) {
                        result += char;
                    }

                    currentVisualWidth += charWidth;
                    charIndex++;
                }
                return result;
            };

            /**
             * 讀取 TXT 檔案內容。
             * @param {File} file - TXT 檔案物件。
             * @returns {Promise<string>} 檔案內容的 Promise。
             */
            function readTxtFile(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve(event.target.result);
                    reader.onerror = (error) => reject(error);
                    // 假設 TXT 檔使用 BIG5 編碼
                    reader.readAsText(file, 'BIG5');
                });
            }

            /**
             * 讀取 Excel 檔案內容為 ArrayBuffer。
             * @param {File} file - Excel 檔案物件。
             * @returns {Promise<ArrayBuffer>} 檔案內容的 Promise。
             */
            function readExcelFile(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve(event.target.result);
                    reader.onerror = (error) => reject(error);
                    reader.readAsArrayBuffer(file);
                });
            }

            /**
             * 比較兩個檔案的資料。
             * 讀取檔案內容，解析資料，然後執行比對。
             */
            async function compareFiles() {
                const txtFile = txtFileInput.files[0];
                const excelFile = excelFileInput.files[0];

                // 檢查是否同時上傳了兩個檔案
                if (!txtFile || !excelFile) {
                    showMessageBox('請同時上傳 TXT 檔和 Excel 檔。');
                    return;
                }

                // 清除之前的比對結果並禁用檢視按鈕
                clearResults();
                viewTxtDataBtn.disabled = true;
                viewExcelDataBtn.disabled = true;
                printResultsBtn.disabled = true;
                unhideAllBtn.disabled = true; // 禁用顯示所有隱藏資料按鈕
                parsedTxtRecords = [];
                parsedExcelRecords = [];

                try {
                    // 讀取 TXT 檔案內容
                    const txtData = await readTxtFile(txtFile);
                    // 讀取 Excel 檔案內容
                    const excelData = await readExcelFile(excelFile);

                    // 解析檔案內容為結構化資料
                    parsedTxtRecords = parseTxtData(txtData);
                    parsedExcelRecords = parseExcelData(excelData);

                    // 更新讀取資料總數顯示
                    txtReadCountSpan.textContent = `(讀取 ${parsedTxtRecords.length} 筆資料)`;
                    excelReadCountSpan.textContent = `(讀取 ${parsedExcelRecords.length} 筆資料)`;

                    // 啟用檢視按鈕和列印按鈕
                    viewTxtDataBtn.disabled = false;
                    viewExcelDataBtn.disabled = false;
                    printResultsBtn.disabled = false;
                    unhideAllBtn.disabled = false; // 啟用顯示所有隱藏資料按鈕

                    // 執行資料比對
                    performComparison(parsedTxtRecords, parsedExcelRecords);

                } catch (error) {
                    console.error('檔案處理錯誤:', error);
                    showMessageBox('檔案處理失敗，請檢查檔案格式或編碼是否正確。錯誤訊息: ' + error.message);
                }
            }

            /**
             * 解析 TXT 檔案的資料。
             * 根據預定義的視覺寬度位置截取 病歷號、姓名、申報金額。
             * @param {string} data - TXT 檔案的原始字串內容。
             * @returns {Array<Object>} 解析後的資料陣列。
             */
            function parseTxtData(data) {
                const lines = data.split('\r\n');
                const records = [];
                let dataStarted = false;

                const COL_MEDICAL_RECORD_ID_START = 0;
                const COL_MEDICAL_RECORD_ID_LENGTH = 8;

                const COL_NAME_START = 9;
                const COL_NAME_LENGTH = 8;

                const COL_BIRTH_DATE_START = 33;
                const COL_BIRTH_DATE_LENGTH = 8;

                const COL_INSPECTION_DATE_START = 91;
                const COL_INSPECTION_DATE_LENGTH = 9;

                const COL_DECLARED_AMOUNT_START = 110;
                const COL_DECLARED_AMOUNT_LENGTH = 5;

                for (const line of lines) {
                    if (line.includes('病 歷 號') && line.includes('姓    名') && line.includes('金額')) {
                        dataStarted = true;
                        continue;
                    }
                    if (!dataStarted || line.trim() === '' || line.includes('頁次:') ||
                        line.includes('─────────────') || line.includes('══════════════════════════════════════════════════════════') ||
                        line.includes('──── ────')) {
                        continue;
                    }

                    const potentialMedicalRecordId = line.substrByVisualWidth(COL_MEDICAL_RECORD_ID_START, COL_MEDICAL_RECORD_ID_LENGTH).trim();
                    if (!/\d/.test(potentialMedicalRecordId) && potentialMedicalRecordId.length > 0 && potentialMedicalRecordId.length < 10) {
                         console.warn('跳過可能為診所名稱或非資料行:', line);
                         continue;
                    }

                    try {
                        const medicalRecordId = line.substrByVisualWidth(COL_MEDICAL_RECORD_ID_START, COL_MEDICAL_RECORD_ID_LENGTH).trim();
                        const name = line.substrByVisualWidth(COL_NAME_START, COL_NAME_LENGTH).trim();
                        const birthDate = line.substrByVisualWidth(COL_BIRTH_DATE_START, COL_BIRTH_DATE_LENGTH).trim();
                        const inspectionDate = line.substrByVisualWidth(COL_INSPECTION_DATE_START, COL_INSPECTION_DATE_LENGTH).trim();
                        const declaredAmount = parseInt(line.substrByVisualWidth(COL_DECLARED_AMOUNT_START, COL_DECLARED_AMOUNT_LENGTH).trim(), 10);

                        if (medicalRecordId && name && birthDate && inspectionDate && !isNaN(declaredAmount)) {
                            records.push({
                                medicalRecordId: medicalRecordId,
                                name: name,
                                birthDate: birthDate,
                                inspectionDate: inspectionDate,
                                declaredAmount: declaredAmount
                            });
                        } else {
                             console.warn('無法解析 TXT 行中的關鍵資料 (病歷號, 姓名, 出生日期, 檢驗日期 或 金額)，跳過此行:', line);
                        }
                    } catch (e) {
                        console.warn('解析 TXT 行時發生錯誤:', line, e);
                    }
                }
                return records;
            }

            /**
             * 使用 SheetJS 解析 Excel 檔案的資料。
             * @param {ArrayBuffer} data - Excel 檔案的 ArrayBuffer 內容。
             * @returns {Array<Object>} 解析後的資料陣列。
             */
            function parseExcelData(data) {
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                const records = [];
                let headerRow = null;
                let headerRowIndex = -1;

                for (let i = 0; i < Math.min(json.length, 20); i++) {
                    const row = json[i];
                    if (Array.isArray(row) &&
                        row.some(cell => typeof cell === 'string' && cell.includes('病歷號碼')) &&
                        row.some(cell => typeof cell === 'string' && cell.includes('病患姓名')) &&
                        row.some(cell => typeof cell === 'string' && cell.includes('生日')) &&
                        row.some(cell => typeof cell === 'string' && cell.includes('檢驗日期')) &&
                        row.some(cell => typeof cell === 'string' && cell.includes('打折後申報金額'))) {
                        headerRow = row.map(cell => typeof cell === 'string' ? cell.trim() : '');
                        headerRowIndex = i;
                        break;
                    }
                }

                if (!headerRow) {
                    throw new Error('Excel 文件中找不到包含所有必要欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 打折後申報金額) 的標題行。');
                }

                const medicalRecordIdColIndex = headerRow.indexOf('病歷號碼');
                const nameColIndex = headerRow.indexOf('病患姓名');
                const birthDateColIndex = headerRow.indexOf('生日');
                const inspectionDateColIndex = headerRow.indexOf('檢驗日期');
                const amountColIndex = headerRow.indexOf('打折後申報金額');

                if (medicalRecordIdColIndex === -1 || nameColIndex === -1 ||
                    birthDateColIndex === -1 || inspectionDateColIndex === -1 ||
                    amountColIndex === -1) {
                    throw new Error('Excel 文件缺少必要的欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 或 打折後申報金額)。');
                }

                for (let i = headerRowIndex + 1; i < json.length; i++) {
                    const row = json[i];
                    if (!Array.isArray(row) || row.length === 0) continue;

                    try {
                        const medicalRecordId = (row[medicalRecordIdColIndex] || '').toString().trim();
                        const name = (row[nameColIndex] || '').toString().trim();
                        const birthDate = (row[birthDateColIndex] || '').toString().trim();
                        const inspectionDate = (row[inspectionDateColIndex] || '').toString().trim();
                        const declaredAmount = parseInt((row[amountColIndex] || '0').toString().trim(), 10);

                        if (medicalRecordId && name && birthDate && inspectionDate && !isNaN(declaredAmount)) {
                            records.push({
                                medicalRecordId: medicalRecordId,
                                name: name,
                                birthDate: birthDate,
                                inspectionDate: inspectionDate,
                                declaredAmount: declaredAmount
                            });
                        } else {
                            console.warn('無法解析 Excel 行中的關鍵資料，跳過此行:', row);
                        }
                    } catch (e) {
                        console.warn('解析 Excel 行時發生錯誤:', row, e);
                    }
                }
                return records;
            }

            /**
             * 執行兩個資料集之間的比對。
             * 找出在一個檔案中存在，但在另一個檔案中不存在的記錄。
             * @param {Array<Object>} txtRecords - 從 TXT 檔案解析的記錄。
             * @param {Array<Object>} excelRecords - 從 Excel 檔案解析的記錄。
             */
            function performComparison(txtRecords, excelRecords) {
                const txtOnly = [];
                const excelOnly = [];

                for (const txtRec of txtRecords) {
                    const foundInExcel = excelRecords.some(excelRec =>
                        excelRec.name === txtRec.name && excelRec.declaredAmount === txtRec.declaredAmount
                    );
                    if (!foundInExcel) {
                        txtOnly.push(txtRec);
                    }
                }

                for (const excelRec of excelRecords) {
                    const foundInTxt = txtRecords.some(txtRec =>
                        txtRec.name === excelRec.name && txtRec.declaredAmount === excelRec.declaredAmount
                    );
                    if (!foundInTxt) {
                        excelOnly.push(excelRec);
                    }
                }

                displayResults(txtOnly, txtMissingInExcelTableBody, hideZeroTxtAmountCheckbox);
                displayResults(excelOnly, excelMissingInTxtTableBody, hideZeroExcelAmountCheckbox);

                if (txtOnly.length === 0 && excelOnly.length === 0) {
                    showMessageBox('比對完成！兩份文件所有姓名和申報金額的資料均匹配。');
                } else if (txtOnly.length > 0 || excelOnly.length > 0) {
                    showMessageBox('比對完成！請查看下方表格，找出未匹配的資料。');
                }
            }

            /**
             * 將結果顯示在指定的表格中。
             * @param {Array<Object>} records - 要顯示的記錄陣列。
             * @param {HTMLElement} tableBodyElement - 目標表格的 tbody 元素。
             * @param {HTMLInputElement} hideZeroAmountCheckbox - 隱藏金額為0的勾選框元素。
             */
            function displayResults(records, tableBodyElement, hideZeroAmountCheckbox) {
                tableBodyElement.innerHTML = '';

                if (records.length === 0) {
                    const row = tableBodyElement.insertRow();
                    const cell = row.insertCell();
                    cell.colSpan = 6; // 增加一列用於勾選框
                    cell.textContent = '所有資料皆已匹配。';
                    cell.classList.add('no-match-message');
                    return;
                }

                records.forEach(record => {
                    const row = tableBodyElement.insertRow();
                    // 新增勾選方框的單元格
                    const checkboxCell = row.insertCell();
                    checkboxCell.classList.add('hide-row-checkbox-cell'); // 添加 class 以便列印時隱藏
                    const label = document.createElement('label'); // 使用 label 包裹 checkbox
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.classList.add('hide-row-checkbox'); // 添加 class 以便選擇
                    label.appendChild(checkbox);
                    checkboxCell.appendChild(label); // 將 label 添加到 td 中

                    row.insertCell().textContent = record.medicalRecordId;
                    row.insertCell().textContent = record.name;
                    row.insertCell().textContent = record.birthDate;
                    row.insertCell().textContent = record.inspectionDate;
                    row.insertCell().textContent = record.declaredAmount;

                    // 為行添加數據屬性，用於追蹤狀態
                    row.dataset.amountZero = (record.declaredAmount === 0).toString();
                    row.dataset.hiddenByCheckbox = 'false'; // 初始狀態為未被獨立勾選框隱藏

                    // 初始應用隱藏狀態
                    updateRowVisibility(row, hideZeroAmountCheckbox);

                    // 為獨立勾選框添加事件監聽器
                    checkbox.addEventListener('change', function() {
                        row.dataset.hiddenByCheckbox = this.checked.toString();
                        updateRowVisibility(row, hideZeroAmountCheckbox);
                    });
                });
            }

            /**
             * 更新單行資料的顯示/隱藏狀態。
             * @param {HTMLElement} row - 要更新的表格行元素。
             * @param {HTMLInputElement} hideZeroAmountCheckbox - 隱藏金額為0的勾選框元素。
             */
            function updateRowVisibility(row, hideZeroAmountCheckbox) {
                const isAmountZero = row.dataset.amountZero === 'true';
                const isHiddenByIndividualCheckbox = row.dataset.hiddenByCheckbox === 'true';
                const isHideZeroAmountChecked = hideZeroAmountCheckbox.checked;

                // 如果被獨立勾選框隱藏，或者金額為0且隱藏金額為0的勾選框被勾選，則隱藏該行
                if (isHiddenByIndividualCheckbox || (isAmountZero && isHideZeroAmountChecked)) {
                    row.classList.add('hidden-row');
                } else {
                    row.classList.remove('hidden-row');
                }
            }

            /**
             * 根據勾選框狀態顯示或隱藏金額為0的行。
             * 此函數現在會重新評估所有行的可見性。
             * @param {HTMLElement} tableBodyElement - 目標表格的 tbody 元素。
             * @param {boolean} isChecked - 勾選框是否被選中。
             * @param {string} type - 觸發的勾選框類型 ('amount' 或 'individual')。
             */
            function toggleRowsVisibility(tableBodyElement, isChecked, type) {
                const rows = tableBodyElement.querySelectorAll('tr');
                const hideZeroAmountCheckboxForTable = (tableBodyElement.id === 'txtMissingInExcel' ? hideZeroTxtAmountCheckbox : hideZeroExcelAmountCheckbox);

                rows.forEach(row => {
                    updateRowVisibility(row, hideZeroAmountCheckboxForTable);
                });
            }

            /**
             * 顯示所有隱藏的資料。
             */
            function unhideAllRows() {
                // 重置兩個表格的「隱藏申報金額為 0 的資料」勾選框到預設狀態
                hideZeroTxtAmountCheckbox.checked = false;
                hideZeroExcelAmountCheckbox.checked = true;

                // 遍歷所有表格行，取消勾選獨立的隱藏方框並更新可見性
                const allRows = document.querySelectorAll('#txtMissingInExcel tbody tr, #excelMissingInTxt tbody tr');
                allRows.forEach(row => {
                    const individualCheckbox = row.querySelector('.hide-row-checkbox');
                    if (individualCheckbox) {
                        individualCheckbox.checked = false; // 取消勾選
                        row.dataset.hiddenByCheckbox = 'false'; // 重置數據屬性
                    }
                    // 重新評估行的可見性，根據新的勾選框狀態
                    const hideZeroAmountCheckboxForTable = (row.closest('table').id === 'txtMissingInExcel' ? hideZeroTxtAmountCheckbox : hideZeroExcelAmountCheckbox);
                    updateRowVisibility(row, hideZeroAmountCheckboxForTable);
                });

                showMessageBox('所有隱藏資料已顯示。');
            }


            /**
             * 執行列印功能。
             */
            function printResults() {
                const printWindow = window.open('', '_blank');
                printWindow.document.write('<html><head><title>比對結果列印</title>');
                printWindow.document.write('<script src="https://cdn.tailwindcss.com"><\/script>');
                printWindow.document.write('<link rel="stylesheet" href="./css/index.css">');
                printWindow.document.write('</head><body>');

                // 創建一個臨時 div 來複製和清理 resultsSection 的內容
                const tempDiv = document.createElement('div');
                // 複製 resultsSection 的當前可見內容（包括隱藏的行，但它們會被 print CSS 再次處理）
                // 為了確保只列印可見的行，我們需要更精確地複製
                const clonedResultsSection = resultsSection.cloneNode(true);

                // 在克隆的內容中移除不希望列印的元素
                clonedResultsSection.querySelectorAll('.hide-zero-amount-checkbox-group').forEach(el => el.remove());
                clonedResultsSection.querySelectorAll('.no-match-message').forEach(el => el.remove());
                clonedResultsSection.querySelectorAll('.record-count').forEach(el => el.remove());
                clonedResultsSection.querySelectorAll('.hide-row-checkbox-cell').forEach(el => el.remove()); // 移除獨立勾選框的單元格

                // 將清理後的內容添加到列印視窗的 body 中
                printWindow.document.write('<div class="print-area">'); // 重新添加 print-area class
                printWindow.document.write(clonedResultsSection.innerHTML); // 插入清理後的內容
                printWindow.document.write('</div>');
                printWindow.document.write('</body></html>');
                printWindow.document.close();
                printWindow.focus();

                // 等待內容加載完成後再列印，避免內容缺失
                printWindow.onload = function() {
                    printWindow.print();
                    // printWindow.close(); // 根據需求決定是否自動關閉
                };

                 // 設置一個短延遲作為備用，以防 onload 事件沒有觸發
                setTimeout(() => {
                    try {
                        if (printWindow && !printWindow.closed) { // 檢查視窗是否仍然存在
                            printWindow.focus();
                            printWindow.print();
                        }
                    } catch (e) {
                        console.error('列印失敗 (備用):', e);
                        showMessageBox('列印功能可能被瀏覽器阻止，請檢查您的瀏覽器設定。');
                    }
                }, 500); // 500 毫秒延遲
            }

            /**
             * 清除結果表格的內容。
             */
            function clearResults() {
                txtMissingInExcelTableBody.innerHTML = '';
                excelMissingInTxtTableBody.innerHTML = '';
                hideZeroTxtAmountCheckbox.checked = false;
                hideZeroExcelAmountCheckbox.checked = true;
                compareBtn.disabled = true;
                compareBtn.classList.remove('highlight-button');
                printResultsBtn.disabled = true;
                unhideAllBtn.disabled = true; // 清除時禁用顯示所有隱藏資料按鈕

                // 重置讀取資料總數顯示
                txtReadCountSpan.textContent = '(讀取 0 筆資料)';
                excelReadCountSpan.textContent = '(讀取 0 筆資料)';
            }

            /**
             * 顯示自定義訊息框。
             * @param {string} message - 要顯示的訊息。
             */
            function showMessageBox(message) {
                const messageBox = document.createElement('div');
                messageBox.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background-color: #333;
                    color: white;
                    padding: 20px 30px;
                    border-radius: 8px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                    z-index: 1000;
                    font-size: 1.1em;
                    text-align: center;
                    opacity: 0;
                    transition: opacity 0.3s ease-in-out;
                    max-width: 80%;
                `;
                messageBox.textContent = message;
                document.body.appendChild(messageBox);

                setTimeout(() => {
                    messageBox.style.opacity = '1';
                }, 10);

                setTimeout(() => {
                    messageBox.style.opacity = '0';
                    messageBox.addEventListener('transitionend', () => messageBox.remove());
                }, 3000);
            }

            /**
             * 顯示解析後的資料在彈出視窗中。
             * @param {Array<Object>} data - 要顯示的資料陣列。
             * @param {string} title - 彈出視窗的標題。
             */
            function displayParsedData(data, title) {
                modalTitle.textContent = title;
                parsedDataDisplay.textContent = JSON.stringify(data, null, 2);
                dataModal.style.display = 'flex';
            }
        });