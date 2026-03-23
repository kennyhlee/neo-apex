/**
 * Internationalization (I18n) System
 * Supports Chinese (zh-CN) and English (en-US)
 */

// Translation data
const translations = {
    'zh-CN': {
        // Navbar
        'nav.home': '首页',
        'nav.lead': '客户',
        'nav.student': '学生',
        'nav.program': '课程',
        'nav.teacher': '教师',
        'nav.report': '报表',
        'nav.currentSite': '当前校区',
        'nav.profile': '个人资料',
        'nav.switchSite': '切换校区',
        'nav.language': '语言',
        'nav.settings': '设置',
        'nav.help': '帮助',
        'nav.logout': '登出',
        'nav.systemName': '成长学苑管理系统',
        
        // Sites
        'site.headquarters': '总部校区',
        'site.east': '东城分校',
        'site.west': '西城分校',
        'site.south': '南城分校',
        'site.north': '北城分校',
        
        // Homepage
        'homepage.title': '员工仪表盘',
        'homepage.totalStudents': '在校学生总数',
        'homepage.attendanceRate': '今日学生出勤率',
        'homepage.totalCourses': '今日课程总数',
        'homepage.quickActions': '快捷功能',
        'homepage.addStudent': '添加学生',
        'homepage.addLead': '添加客户',
        'homepage.viewReports': '查看报表',
        'homepage.schedule': '课程安排',
        'homepage.recentEvents': '最近活动',
        'homepage.todaySchedule': '今日课程表',
        'homepage.noEvents': '暂无活动',
        'homepage.noSchedule': '今日无课程安排',
        
        // Students
        'students.title': '学生管理系统',
        'students.searchName': '学生姓名',
        'students.searchNamePlaceholder': '输入学生姓名',
        'students.searchId': '学号',
        'students.searchIdPlaceholder': '输入学号',
        'students.searchGrade': '年级',
        'students.allGrades': '全部年级',
        'students.searchSchool': '在读学校',
        'students.searchSchoolPlaceholder': '输入学校名称',
        'students.searchStatus': '学生状态',
        'students.allStatus': '全部状态',
        'students.searchEnrollmentDate': '入学日期',
        'students.searchPhone': '联系电话',
        'students.searchPhonePlaceholder': '输入联系电话',
        'students.searchTeacher': '班主任',
        'students.allTeachers': '全部班主任',
        'students.search': '搜索',
        'students.reset': '重置',
        'students.addStudent': '添加学生',
        'students.export': '导出',
        'students.batchExport': '批量导出',
        'students.batchActions': '批量操作',
        'students.gender': '性别',
        'students.enrollmentDate': '入学日期',
        'students.name': '学生姓名',
        'students.studentId': '学号',
        'students.grade': '年级/班级',
        'students.school': '在读学校',
        'students.parent': '家长姓名',
        'students.phone': '联系电话',
        'students.status': '状态',
        'students.actions': '操作',
        'students.view': '查看',
        'students.edit': '编辑',
        'students.noResults': '暂无学生数据',
        'students.status.normal': '正常上课中',
        'students.status.leave': '请假中',
        'students.status.absent': '缺勤',
        'students.status.suspended': '休学',
        'students.status.graduated': '已毕业',
        'students.status.dropped': '已退学',
        
        // Program
        'program.title': '成长学苑课程管理',
        'program.studentManagement': '课程学生管理',
        'program.currentCourse': '当前课程',
        'program.semester': '2025年秋季学期 (9月-12月)',
        'program.filter': '筛选学生',
        'program.batchActions': '批量操作',
        'program.roster': '学生花名册',
        'program.students': '名学生',
        'program.lastUpdate': '最后更新',
        'program.export': '导出名单',
        'program.addStudent': '添加学生',
        'program.schedule': '个人课程安排表',
        'program.week': '2025年10月27日 - 2025年11月2日',
        'program.studentId': '学生ID',
        'program.print': '打印',
        'program.switchWeek': '切换周次',
        'program.time.morning': '上午',
        'program.time.afternoon': '下午',
        'program.time.evening': '晚上',
        'program.status.signed': '已签到',
        'program.status.pending': '待签到',
        'program.noStudents': '暂无学生',
        'program.courses.math.elementary': '小学数学思维训练',
        'program.courses.math.middle': '初中数学强化班',
        'program.courses.math.high': '高中数学强化训练',
        'program.courses.english.speaking': '英语口语班',
        'program.courses.english.gaokao': '高考英语特训营',
        
        // Lead
        'lead.title': '客户管理',
        
        // Common
        'common.loading': '加载中...',
        'common.save': '保存',
        'common.cancel': '取消',
        'common.delete': '删除',
        'common.confirm': '确认',
        'common.close': '关闭',
        'common.yes': '是',
        'common.no': '否',
        'common.page': '页',
        'common.of': '共',
        'common.records': '条记录',
        'common.previous': '上一页',
        'common.next': '下一页',
        'common.showing': '显示',
        'common.to': '到',
        
        // Grades
        'grade.grade1': '一年级',
        'grade.grade2': '二年级',
        'grade.grade3': '三年级',
        'grade.grade4': '四年级',
        'grade.grade5': '五年级',
        'grade.grade6': '六年级',
        'grade.middle1': '初一',
        'grade.middle2': '初二',
        'grade.middle3': '初三',
        'grade.high1': '高一',
        'grade.high2': '高二',
        'grade.high3': '高三',
    },
    'en-US': {
        // Navbar
        'nav.home': 'Home',
        'nav.lead': 'Leads',
        'nav.student': 'Students',
        'nav.program': 'Programs',
        'nav.teacher': 'Teachers',
        'nav.report': 'Reports',
        'nav.currentSite': 'Current Campus',
        'nav.profile': 'Profile',
        'nav.switchSite': 'Switch Campus',
        'nav.language': 'Language',
        'nav.settings': 'Settings',
        'nav.help': 'Help',
        'nav.logout': 'Logout',
        'nav.systemName': 'Growth Academy Management System',
        
        // Sites
        'site.headquarters': 'Headquarters',
        'site.east': 'East Campus',
        'site.west': 'West Campus',
        'site.south': 'South Campus',
        'site.north': 'North Campus',
        
        // Homepage
        'homepage.title': 'Employee Dashboard',
        'homepage.totalStudents': 'Total Students',
        'homepage.attendanceRate': 'Today\'s Attendance Rate',
        'homepage.totalCourses': 'Today\'s Total Courses',
        'homepage.quickActions': 'Quick Actions',
        'homepage.addStudent': 'Add Student',
        'homepage.addLead': 'Add Lead',
        'homepage.viewReports': 'View Reports',
        'homepage.schedule': 'Schedule',
        'homepage.recentEvents': 'Recent Events',
        'homepage.todaySchedule': 'Today\'s Schedule',
        'homepage.noEvents': 'No events',
        'homepage.noSchedule': 'No schedule for today',
        
        // Students
        'students.title': 'Student Management System',
        'students.searchName': 'Student Name',
        'students.searchNamePlaceholder': 'Enter student name',
        'students.searchId': 'Student ID',
        'students.searchIdPlaceholder': 'Enter student ID',
        'students.searchGrade': 'Grade',
        'students.allGrades': 'All Grades',
        'students.searchSchool': 'School',
        'students.searchSchoolPlaceholder': 'Enter school name',
        'students.searchStatus': 'Status',
        'students.allStatus': 'All Status',
        'students.searchEnrollmentDate': 'Enrollment Date',
        'students.searchPhone': 'Phone',
        'students.searchPhonePlaceholder': 'Enter phone number',
        'students.searchTeacher': 'Teacher',
        'students.allTeachers': 'All Teachers',
        'students.search': 'Search',
        'students.reset': 'Reset',
        'students.addStudent': 'Add Student',
        'students.export': 'Export',
        'students.batchExport': 'Batch Export',
        'students.batchActions': 'Batch Actions',
        'students.gender': 'Gender',
        'students.enrollmentDate': 'Enrollment Date',
        'students.name': 'Name',
        'students.studentId': 'Student ID',
        'students.grade': 'Grade/Class',
        'students.school': 'School',
        'students.parent': 'Parent Name',
        'students.phone': 'Phone',
        'students.status': 'Status',
        'students.actions': 'Actions',
        'students.view': 'View',
        'students.edit': 'Edit',
        'students.noResults': 'No student data',
        'students.status.normal': 'Active',
        'students.status.leave': 'On Leave',
        'students.status.absent': 'Absent',
        'students.status.suspended': 'Suspended',
        'students.status.graduated': 'Graduated',
        'students.status.dropped': 'Dropped Out',
        
        // Program
        'program.title': 'Course Management',
        'program.studentManagement': 'Course Student Management',
        'program.currentCourse': 'Current Course',
        'program.semester': 'Fall 2025 Semester (Sep-Dec)',
        'program.filter': 'Filter Students',
        'program.batchActions': 'Batch Actions',
        'program.roster': 'Student Roster',
        'program.students': 'students',
        'program.lastUpdate': 'Last Updated',
        'program.export': 'Export List',
        'program.addStudent': 'Add Student',
        'program.schedule': 'Personal Course Schedule',
        'program.week': 'Oct 27, 2025 - Nov 2, 2025',
        'program.studentId': 'Student ID',
        'program.print': 'Print',
        'program.switchWeek': 'Switch Week',
        'program.time.morning': 'Morning',
        'program.time.afternoon': 'Afternoon',
        'program.time.evening': 'Evening',
        'program.status.signed': 'Signed In',
        'program.status.pending': 'Pending',
        'program.noStudents': 'No students',
        'program.courses.math.elementary': 'Elementary Math Training',
        'program.courses.math.middle': 'Middle School Math Intensive',
        'program.courses.math.high': 'High School Math Training',
        'program.courses.english.speaking': 'English Speaking Class',
        'program.courses.english.gaokao': 'Gaokao English Intensive',
        
        // Lead
        'lead.title': 'Lead Management',
        
        // Common
        'common.loading': 'Loading...',
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
        'common.confirm': 'Confirm',
        'common.close': 'Close',
        'common.yes': 'Yes',
        'common.no': 'No',
        'common.page': 'Page',
        'common.of': 'of',
        'common.records': 'records',
        'common.previous': 'Previous',
        'common.next': 'Next',
        'common.showing': 'Showing',
        'common.to': 'to',
        
        // Grades
        'grade.grade1': 'Grade 1',
        'grade.grade2': 'Grade 2',
        'grade.grade3': 'Grade 3',
        'grade.grade4': 'Grade 4',
        'grade.grade5': 'Grade 5',
        'grade.grade6': 'Grade 6',
        'grade.middle1': 'Grade 7',
        'grade.middle2': 'Grade 8',
        'grade.middle3': 'Grade 9',
        'grade.high1': 'Grade 10',
        'grade.high2': 'Grade 11',
        'grade.high3': 'Grade 12',
    }
};

// Current language (default to Chinese)
let currentLanguage = localStorage.getItem('preferredLanguage') || 'zh-CN';

/**
 * Get translation for a key
 * @param {string} key - Translation key
 * @param {Object} params - Optional parameters for string interpolation
 * @returns {string} Translated string
 */
function t(key, params = {}) {
    const translation = translations[currentLanguage]?.[key] || key;
    
    // Simple parameter replacement
    if (params && Object.keys(params).length > 0) {
        return translation.replace(/\{(\w+)\}/g, (match, paramKey) => {
            return params[paramKey] !== undefined ? params[paramKey] : match;
        });
    }
    
    return translation;
}

/**
 * Set language and update the page
 * @param {string} lang - Language code ('zh-CN' or 'en-US')
 */
function setLanguage(lang) {
    if (!translations[lang]) {
        console.warn(`Language ${lang} not supported`);
        return;
    }
    
    currentLanguage = lang;
    localStorage.setItem('preferredLanguage', lang);
    
    // Update HTML lang attribute
    document.documentElement.lang = lang;
    
    // Trigger translation update
    updatePageTranslations();
    
    // Dispatch event for other components
    document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
}

/**
 * Get current language
 * @returns {string} Current language code
 */
function getCurrentLanguage() {
    return currentLanguage;
}

/**
 * Update all translatable elements on the page
 */
function updatePageTranslations() {
    // Update elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = t(key);
        
        // Handle different element types
        if (element.tagName === 'INPUT' && element.type === 'text' || element.type === 'search') {
            element.placeholder = translation;
        } else if (element.tagName === 'INPUT' && element.type === 'submit' || element.type === 'button') {
            element.value = translation;
        } else if (element.tagName === 'TITLE') {
            element.textContent = translation;
        } else {
            element.textContent = translation;
        }
    });
    
    // Update elements with data-i18n-html attribute (for HTML content)
    document.querySelectorAll('[data-i18n-html]').forEach(element => {
        const key = element.getAttribute('data-i18n-html');
        element.innerHTML = t(key);
    });
    
    // Update elements with data-i18n-attr attribute (for attributes)
    document.querySelectorAll('[data-i18n-attr]').forEach(element => {
        const attrData = element.getAttribute('data-i18n-attr');
        const [attrName, key] = attrData.split(':');
        if (attrName && key) {
            element.setAttribute(attrName, t(key));
        }
    });
    
    // Update elements with data-i18n-status attribute (for status badges)
    document.querySelectorAll('[data-i18n-status]').forEach(element => {
        const status = element.getAttribute('data-i18n-status');
        if (status && translateStatus) {
            element.textContent = translateStatus(status);
        }
    });
}

/**
 * Initialize I18n system
 */
function initI18n() {
    // Set initial language
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang && translations[savedLang]) {
        currentLanguage = savedLang;
    }
    
    // Update HTML lang attribute
    document.documentElement.lang = currentLanguage;
    
    // Update translations on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updatePageTranslations);
    } else {
        updatePageTranslations();
    }
}

// Auto-initialize when script loads
initI18n();

/**
 * Translate status value (maps Chinese status to translation key)
 * @param {string} status - Status value in Chinese
 * @returns {string} Translated status
 */
function translateStatus(status) {
    const statusMap = {
        '正常上课中': 'students.status.normal',
        '请假中': 'students.status.leave',
        '缺勤': 'students.status.absent',
        '休学': 'students.status.suspended',
        '已毕业': 'students.status.graduated',
        '已退学': 'students.status.dropped',
        '已签到': 'program.status.signed',
        '待签到': 'program.status.pending'
    };
    
    const key = statusMap[status];
    return key ? t(key) : status;
}

// Export for use in other scripts
window.i18n = {
    t,
    setLanguage,
    getCurrentLanguage,
    updatePageTranslations,
    translateStatus,
    translations
};

