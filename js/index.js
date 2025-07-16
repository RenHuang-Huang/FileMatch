
        let parsedTxtRecords = []; // 儲存所有解析後的 TXT 記錄，用於主頁面
        let parsedExcelRecords = []; // 儲存所有解析後的 Excel 記錄，用於主頁面
        // let calcDataTableInstance; // 全域變數，用於儲存計算模態視窗的 DataTable 實例 - 已移除
        let calcTotalDeclaredAmount = 0; // 計算模態視窗的申報總額（來自所有解析後的 TXT 記錄）

        // 定義 TXT 檔案解析的完整欄位配置
        const TXT_COLUMN_CONFIG = [
            { header: '病歷號', start: 0, length: 8, key: 'medicalRecordId', type: 'string' },
            { header: '姓名', start: 9, length: 8, key: 'name', type: 'string' },
            { header: '身份證號', start: 18, length: 10, key: 'idNumber', type: 'string' },
            { header: '性別', start: 29, length: 2, key: 'gender', type: 'string' },
            { header: '出生日期', start: 33, length: 8, key: 'birthDate', type: 'date' },
            { header: '機構代號', start: 42, length: 10, key: 'institutionCode', type: 'string' },
            { header: '科別', start: 53, length: 3, key: 'department', type: 'string' },
            { header: '就醫日期', start: 58, length: 9, key: 'visitDate', type: 'date' },
            { header: '健卡序號', start: 68, length: 4, key: 'healthCardSerial', type: 'string', filterable: true }, // 新增 filterable 屬性
            { header: '分類', start: 73, length: 5, key: 'category', type: 'string', filterable: true }, // 新增 filterable 屬性
            { header: '醫師代號', start: 80, length: 10, key: 'doctorID', type: 'string' },
            { header: '檢驗日期', start: 91, length: 9, key: 'inspectionDate', type: 'date' },
            { header: '點數', start: 101, length: 5, key: 'points', type: 'number' },
            { header: '成數', start: 107, length: 4, key: 'percentage', type: 'number' },
            { header: '金額', start: 111, length: 5, key: 'amount', type: 'number' } // 修正 start 值為 111
        ];

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
         * 將日期字符串 (YY.MM.DD 或 YYY.MM.DD) 轉換為 YYYY-MM-DD 格式。
         * @param {string} dateStr - 原始日期字符串。
         * @returns {string} 轉換後的日期字符串 (YYYY-MM-DD) 或原始字符串（如果格式不匹配）。
         */
        function convertDateToISO(dateStr) {
            const parts = dateStr.split('.');
            if (parts.length === 3) {
                let year = parseInt(parts[0], 10);
                const month = parts[1].padStart(2, '0');
                const day = parts[2].padStart(2, '0');

                // 處理民國年 (YY.MM.DD) 或西元年 (YYY.MM.DD)
                if (year < 1911) { // 假設小於1911的是民國年
                    year += 1911;
                }
                return `${year}-${month}-${day}`;
            }
            return dateStr; // 如果格式不匹配，返回原始字符串
        }

        /**
         * 解析 TXT 檔案的資料。
         * 根據預定義的視覺寬度位置截取所有欄位。
         * @param {string} data - TXT 檔案的原始字串內容。
         * @returns {Array<Object>} 解析後的資料陣列。
         */
        function parseTxtData(data) {
            const lines = data.split('\r\n');
            const records = [];
            let dataStarted = false;

            for (const line of lines) {
                // 精確識別標題行
                if (line.includes('病 歷 號') && line.includes('姓    名') && line.includes('金額')) {
                    dataStarted = true;
                    continue;
                }
                // 跳過非資料行或空行，包括分隔線、頁次、診所名稱等
                if (!dataStarted || line.trim() === '' || line.includes('頁次:') ||
                    line.includes('─────────────') || line.includes('══════════════════════════════════════════════════════════') ||
                    line.includes('──── ────')) {
                    continue;
                }

                // 檢查是否是診所名稱行 (例如 "謝坤川診所")
                // 使用 TXT_COLUMN_CONFIG 的第一個欄位 (病歷號) 來檢查
                const potentialMedicalRecordId = line.substrByVisualWidth(TXT_COLUMN_CONFIG[0].start, TXT_COLUMN_CONFIG[0].length).trim();
                if (!/\d/.test(potentialMedicalRecordId) && potentialMedicalRecordId.length > 0 && potentialMedicalRecordId.length < 10) {
                        console.warn('跳過可能為診所名稱或非資料行:', line);
                        continue;
                }

                const record = {};
                let isValidRecord = true;

                // Iterate through the comprehensive TXT_COLUMN_CONFIG to parse all fields
                for (const colConfig of TXT_COLUMN_CONFIG) {
                    let value = line.substrByVisualWidth(colConfig.start, colConfig.length).trim();

                    if (colConfig.type === 'number') {
                        value = parseInt(value, 10);
                        if (isNaN(value)) {
                            console.warn(`無法解析數值欄位 ${colConfig.header}: "${value}"，設定為 0。`);
                            value = 0; // 設定為 0 或 null
                        }
                    } else if (colConfig.type === 'date') {
                        // 將日期轉換為 YYYY-MM-DD 格式，方便比較
                        value = convertDateToISO(value);
                    }
                    record[colConfig.key] = value;
                }

                // 簡易驗證：確保關鍵欄位不為空
                // Use 'amount' key as per TXT_COLUMN_CONFIG
                if (!record.medicalRecordId || !record.name || !record.inspectionDate || isNaN(record.amount)) {
                    isValidRecord = false;
                    console.warn('無法解析 TXT 行中的關鍵資料，跳過此行:', line);
                }

                if (isValidRecord) {
                    records.push(record);
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
            const sheetName = workbook.SheetNames[0]; // 預設讀取第一個工作表
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); // 讀取為陣列的陣列

            const records = [];
            let headerRow = null;
            let headerRowIndex = -1;

            // 搜尋標題行，在 Excel 數據中尋找包含所有必要欄位的行
            for (let i = 0; i < Math.min(json.length, 20); i++) {
                const row = json[i];
                if (Array.isArray(row) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('病歷號碼')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('病患姓名')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('生日')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('檢驗日期')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('打折後申報金額'))) {
                    headerRow = row.map(cell => typeof cell === 'string' ? cell.trim() : ''); // 清理標題
                    headerRowIndex = i;
                    break;
                }
            }

            if (!headerRow) {
                throw new Error('Excel 文件中找不到包含所有必要欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 打折後申報金額) 的標題行。');
            }

            // 根據新的欄位名稱獲取索引
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

            // 從標題行之後的資料行開始解析
            for (let i = headerRowIndex + 1; i < json.length; i++) {
                const row = json[i];
                if (!Array.isArray(row) || row.length === 0) continue; // 跳過空行或非陣列行

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
                // 使用 'amount' 鍵作為 TXT 記錄的依據，與 Excel 記錄的 declaredAmount 進行比對
                const foundInExcel = excelRecords.some(excelRec =>
                    excelRec.name === txtRec.name && excelRec.declaredAmount === txtRec.amount
                );
                if (!foundInExcel) {
                    txtOnly.push(txtRec);
                }
            }

            for (const excelRec of excelRecords) {
                // 使用 'amount' 鍵作為 TXT 記錄的依據，與 Excel 記錄的 declaredAmount 進行比對
                const foundInTxt = txtRecords.some(txtRec =>
                    txtRec.name === excelRec.name && txtRec.amount === excelRec.declaredAmount
                );
                if (!foundInTxt) {
                    excelOnly.push(excelRec);
                }
            }

            displayResults(txtOnly, document.querySelector('#txtMissingInExcel tbody'), document.getElementById('hideZeroTxtAmount'));
            displayResults(excelOnly, document.querySelector('#excelMissingInTxt tbody'), document.getElementById('hideZeroExcelAmount'));

            if (txtOnly.length === 0 && excelOnly.length === 0) {
                showMessageBox('比對完成！兩份文件所有姓名和申報金額的資料均匹配。');
            } else if (txtOnly.length > 0 || excelOnly.length > 0) {
                showMessageBox('比對完成！請查看下方表格，找出未匹配的資料。');
            }
        }

        /**
         * 執行兩個資料集之間的比對。
         */
        async function compareFiles() {
            const txtFile = document.getElementById('txtFile').files[0];
            const excelFile = document.getElementById('excelFile').files[0];

            // 檢查是否同時上傳了兩個檔案
            if (!txtFile || !excelFile) {
                showMessageBox('請同時上傳 TXT 檔和 Excel 檔。');
                return;
            }

            // 清除之前的比對結果並禁用相關按鈕
            clearResults();
            document.getElementById('printResultsBtn').disabled = true;
            document.getElementById('unhideAllBtn').disabled = true;
            document.getElementById('openCalcModalBtn').disabled = true; // 禁用計算按鈕
            document.getElementById('openCalcModalBtn').classList.remove('enabled'); // 移除啟用樣式

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

                // 計算 TXT 申報總額 (用於計算模態視窗)
                calcTotalDeclaredAmount = parsedTxtRecords.reduce((sum, record) => sum + (record.amount || 0), 0);

                // 更新讀取資料總數顯示
                document.getElementById('txtReadCount').textContent = `(讀取 ${parsedTxtRecords.length} 筆資料)`;
                document.getElementById('excelReadCount').textContent = `(讀取 ${parsedExcelRecords.length} 筆資料)`;

                // 啟用相關按鈕
                document.getElementById('printResultsBtn').disabled = false;
                document.getElementById('unhideAllBtn').disabled = false;
                document.getElementById('openCalcModalBtn').disabled = false; // 啟用計算按鈕
                document.getElementById('openCalcModalBtn').classList.add('enabled'); // 添加啟用樣式

                // 執行資料比對
                performComparison(parsedTxtRecords, parsedExcelRecords);

            } catch (error) {
                console.error('檔案處理錯誤:', error);
                showMessageBox('檔案處理失敗，請檢查檔案格式或編碼是否正確。錯誤訊息: ' + error.message);
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

                // 顯示指定的欄位，TXT 記錄使用 'amount'，Excel 記錄使用 'declaredAmount'
                row.insertCell().textContent = record.medicalRecordId;
                row.insertCell().textContent = record.name;
                row.insertCell().textContent = record.birthDate;
                row.insertCell().textContent = record.inspectionDate;
                row.insertCell().textContent = record.amount !== undefined ? record.amount : record.declaredAmount;


                // 為行添加數據屬性，用於追蹤狀態
                const recordAmount = record.amount !== undefined ? record.amount : record.declaredAmount;
                row.dataset.amountZero = (recordAmount === 0).toString();
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
            const hideZeroAmountCheckboxForTable = (tableBodyElement.id === 'txtMissingInExcel' ? document.getElementById('hideZeroTxtAmount') : document.getElementById('hideZeroExcelAmount'));

            rows.forEach(row => {
                updateRowVisibility(row, hideZeroAmountCheckboxForTable);
            });
        }

        /**
         * 顯示所有隱藏的資料。
         */
        function unhideAllRows() {
            // 重置兩個表格的「隱藏申報金額為 0 的資料」勾選框到預設狀態
            document.getElementById('hideZeroTxtAmount').checked = false;
            document.getElementById('hideZeroExcelAmount').checked = true;

            // 遍歷所有表格行，取消勾選獨立的隱藏方框並更新可見性
            const allRows = document.querySelectorAll('#txtMissingInExcel tbody tr, #excelMissingInTxt tbody tr');
            allRows.forEach(row => {
                const individualCheckbox = row.querySelector('.hide-row-checkbox');
                if (individualCheckbox) {
                    individualCheckbox.checked = false; // 取消勾選
                    row.dataset.hiddenByCheckbox = 'false'; // 重置數據屬性
                }
                // 重新評估行的可見性，根據新的勾選框狀態
                const hideZeroAmountCheckboxForTable = (row.closest('table').id === 'txtMissingInExcel' ? document.getElementById('hideZeroTxtAmount') : document.getElementById('hideZeroExcelAmount'));
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
            printWindow.document.write('<style>');
            // 複製主頁面的所有樣式
            Array.from(document.querySelectorAll('style')).forEach(style => {
                printWindow.document.write(style.textContent);
            });
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');

            // 創建一個臨時 div 來複製和清理 resultsSection 的內容
            const clonedResultsSection = document.querySelector('.results-section').cloneNode(true);

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
            };

            setTimeout(() => {
                try {
                    if (printWindow && !printWindow.closed) {
                        printWindow.focus();
                        printWindow.print();
                    }
                } catch (e) {
                    console.error('列印失敗 (備用):', e);
                    showMessageBox('列印功能可能被瀏覽器阻止，請檢查您的瀏覽器設定。');
                }
            }, 500);
        }

        /**
         * 清除結果表格的內容。
         */
        function clearResults() {
            document.querySelector('#txtMissingInExcel tbody').innerHTML = '';
            document.querySelector('#excelMissingInTxt tbody').innerHTML = '';
            document.getElementById('hideZeroTxtAmount').checked = false;
            document.getElementById('hideZeroExcelAmount').checked = true;
            document.getElementById('compareBtn').disabled = true;
            document.getElementById('compareBtn').classList.remove('highlight-button');
            document.getElementById('printResultsBtn').disabled = true;
            document.getElementById('unhideAllBtn').disabled = true;
            document.getElementById('openCalcModalBtn').disabled = true; // 禁用計算按鈕
            document.getElementById('openCalcModalBtn').classList.remove('enabled'); // 移除啟用樣式

            // 重置讀取資料總數顯示
            document.getElementById('txtReadCount').textContent = '(讀取 0 筆資料)';
            document.getElementById('excelReadCount').textContent = '(讀取 0 筆資料)';
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

        // --- Calculation Modal Functions ---

        /**
         * 開啟成健金額計算模態視窗。
         */
        function openCalcModal() {
            const calcModal = document.getElementById('calcModal');
            const calcTotalDeclaredAmountSpan = document.getElementById('calcTotalDeclaredAmount');
            // const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage'); // 仍然需要這個輸入框的值

            if (parsedTxtRecords.length === 0) {
                showMessageBox('請先上傳並比對 TXT 檔案以載入資料。');
                return;
            }

            // 計算 TXT 申報總額 (用於計算模態視窗)
            calcTotalDeclaredAmount = parsedTxtRecords.reduce((sum, record) => sum + (record.amount || 0), 0);
            calcTotalDeclaredAmountSpan.textContent = calcTotalDeclaredAmount.toLocaleString();

            // 不再初始化 DataTable，直接更新計算結果
            updateAllCalculationsForCalcModal();

            calcModal.style.display = 'flex';
        }

        /**
         * 關閉成健金額計算模態視窗。
         */
        function closeCalcModal() {
            document.getElementById('calcModal').style.display = 'none';
            // 關閉時重置折扣百分比
            document.getElementById('calcDiscountPercentage').value = '15';
        }

        // 移除 initializeCalcDataTable 函數，因為不再使用 DataTables

        // 移除 clearCalcFilters 函數，因為沒有手動篩選可清除

        // 移除 exportCalcTableToExcel 函數，因為沒有表格可匯出

        /**
         * 更新計算模態視窗中所有金額計算結果的顯示。
         * 此函數現在會直接根據硬編碼的篩選條件來計算。
         */
        function updateAllCalculationsForCalcModal() {
            const calcTotalDeclaredAmountSpan = document.getElementById('calcTotalDeclaredAmount');
            const calcFilteredAmountSpan = document.getElementById('calcFilteredAmount');
            const calcNonFilteredAmountSpan = document.getElementById('calcNonFilteredAmount');
            const calcDeductionAmountSpan = document.getElementById('calcDeductionAmount');
            const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage');

            // 根據硬編碼的篩選條件過濾 parsedTxtRecords
            const filteredRecords = parsedTxtRecords.filter(record => {
                const isCategoryA3 = record.category && record.category.toLowerCase() === 'a3';
                const isHealthCardIC = record.healthCardSerial && record.healthCardSerial.toLowerCase().startsWith('ic');
                return isCategoryA3 && isHealthCardIC;
            });

            const currentFilteredAmount = filteredRecords.reduce((sum, record) => sum + (record.amount || 0), 0);
            calcFilteredAmountSpan.textContent = currentFilteredAmount.toLocaleString();

            const nonFilteredAmount = calcTotalDeclaredAmount - currentFilteredAmount;
            calcNonFilteredAmountSpan.textContent = nonFilteredAmount.toLocaleString();

            const discount = parseFloat(calcDiscountPercentageInput.value) / 100;
            const deductionAmount = nonFilteredAmount * (isNaN(discount) ? 0 : discount);
            calcDeductionAmountSpan.textContent = deductionAmount.toLocaleString();
        }


        document.addEventListener('DOMContentLoaded', () => {
            // 獲取 DOM 元素
            const txtFileInput = document.getElementById('txtFile');
            const excelFileInput = document.getElementById('excelFile');
            const compareBtn = document.getElementById('compareBtn');
            const printResultsBtn = document.getElementById('printResultsBtn');
            const unhideAllBtn = document.getElementById('unhideAllBtn');
            const hideZeroTxtAmountCheckbox = document.getElementById('hideZeroTxtAmount');
            const hideZeroExcelAmountCheckbox = document.getElementById('hideZeroExcelAmount');
            const txtMissingInExcelTableBody = document.querySelector('#txtMissingInExcel tbody');
            const excelMissingInTxtTableBody = document.querySelector('#excelMissingInTxt tbody');

            // 計算模態視窗的元素
            const openCalcModalBtn = document.getElementById('openCalcModalBtn');
            const closeCalcModalBtn = document.getElementById('closeCalcModalBtn'); // 用於 calcModal
            const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage');
            // const clearCalcFilterBtn = document.getElementById('clearCalcFilterBtn'); // 已移除
            // const exportCalcExcelBtn = document.getElementById('exportCalcExcelBtn'); // 已移除


            // 事件監聽器
            compareBtn.addEventListener('click', compareFiles);
            printResultsBtn.addEventListener('click', printResults);
            unhideAllBtn.addEventListener('click', unhideAllRows);

            hideZeroTxtAmountCheckbox.addEventListener('change', () => toggleRowsVisibility(txtMissingInExcelTableBody, hideZeroTxtAmountCheckbox.checked, 'amount'));
            hideZeroExcelAmountCheckbox.addEventListener('change', () => toggleRowsVisibility(excelMissingInTxtTableBody, hideZeroExcelAmountCheckbox.checked, 'amount'));

            txtFileInput.addEventListener('change', checkFilesAndEnableButton);
            excelFileInput.addEventListener('change', checkFilesAndEnableButton);

            // calcModal 的事件監聽器
            openCalcModalBtn.addEventListener('click', openCalcModal);
            closeCalcModalBtn.addEventListener('click', closeCalcModal);
            calcDiscountPercentageInput.addEventListener('input', updateAllCalculationsForCalcModal);
            // clearCalcFilterBtn.addEventListener('click', clearCalcFilters); // 已移除
            // exportCalcExcelBtn.addEventListener('click', exportCalcTableToExcel); // 已移除

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
                    // 如果檔案被清除，禁用所有相關按鈕
                    printResultsBtn.disabled = true;
                    unhideAllBtn.disabled = true;
                    openCalcModalBtn.disabled = true;
                    openCalcModalBtn.classList.remove('enabled');
                    clearResults(); // 清除主頁面比對結果
                }
            }
        });