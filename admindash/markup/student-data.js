/**
 * Shared Student Data
 * Contains all student information, schedules, and program data
 * Used by program.html and students.html
 */

// All students data - keyed by student name for easy lookup
const allStudentsData = {
    // Students from students.html (60 students)
    '李明轩': {
        name: '李明轩',
        studentId: 'S20231205',
        gender: '男',
        grade: '高三(3)班',
        school: '北苑中学',
        phone: '13800138000',
        parent: '李先生',
        status: '正常上课中',
        enrollmentDate: '2020-09-01',
        teacher: '张老师',
        email: 'limingxuan@example.com',
        birthDate: '2006-03-18',
        address: '北京市海淀区中关村大街123号',
        householdAddress: '北京市朝阳区建国路88号',
        family: [
            { name: '李先生', relation: '父亲', phone: '13800138000', occupation: '工程师' },
            { name: '李女士', relation: '母亲', phone: '13800138001', occupation: '教师' }
        ]
    },
    '张雨': {
        name: '张雨',
        studentId: 'S20231206',
        gender: '女',
        grade: '高三(1)班',
        school: '北苑中学',
        phone: '13900139000',
        parent: '张女士',
        status: '正常上课中',
        enrollmentDate: '2020-09-01',
        teacher: '李老师',
        email: 'zhangyu@example.com',
        birthDate: '2006-05-20',
        address: '北京市海淀区学院路456号',
        householdAddress: '北京市海淀区学院路456号',
        family: [
            { name: '张女士', relation: '母亲', phone: '13900139000', occupation: '医生' }
        ]
    },
    '王浩': {
        name: '王浩',
        studentId: 'S20231207',
        gender: '男',
        grade: '高三(3)班',
        school: '北苑中学',
        phone: '13700137000',
        parent: '王先生',
        status: '请假中',
        enrollmentDate: '2020-09-01',
        teacher: '王老师',
        email: 'wanghao@example.com',
        birthDate: '2006-07-15',
        address: '北京市朝阳区三里屯789号',
        householdAddress: '北京市朝阳区三里屯789号',
        family: [
            { name: '王先生', relation: '父亲', phone: '13700137000', occupation: '商人' }
        ]
    },
    '陈晓': {
        name: '陈晓',
        studentId: 'S20231208',
        gender: '女',
        grade: '高三(4)班',
        school: '城东中学',
        phone: '13600136000',
        parent: '陈先生',
        status: '正常上课中',
        enrollmentDate: '2020-09-01',
        teacher: '赵老师',
        email: 'chenxiao@example.com',
        birthDate: '2006-09-10',
        address: '北京市西城区西单101号',
        householdAddress: '北京市西城区西单101号',
        family: [
            { name: '陈先生', relation: '父亲', phone: '13600136000', occupation: '律师' }
        ]
    },
    '赵婷': {
        name: '赵婷',
        studentId: 'S20231209',
        gender: '女',
        grade: '高三(2)班',
        school: '北苑中学',
        phone: '13500135000',
        parent: '赵女士',
        status: '正常上课中',
        enrollmentDate: '2020-09-01',
        teacher: '张老师',
        email: 'zhaoting@example.com',
        birthDate: '2006-11-25',
        address: '北京市海淀区五道口202号',
        householdAddress: '北京市海淀区五道口202号',
        family: [
            { name: '赵女士', relation: '母亲', phone: '13500135000', occupation: '会计' }
        ]
    },
    '刘强': {
        name: '刘强',
        studentId: 'S20231210',
        gender: '男',
        grade: '高三(5)班',
        school: '城西中学',
        phone: '13400134000',
        parent: '刘先生',
        status: '正常上课中',
        enrollmentDate: '2020-09-01',
        teacher: '李老师',
        email: 'liuqiang@example.com',
        birthDate: '2006-01-08',
        address: '北京市丰台区方庄303号',
        householdAddress: '北京市丰台区方庄303号',
        family: [
            { name: '刘先生', relation: '父亲', phone: '13400134000', occupation: '公务员' }
        ]
    },
    '周静': {
        name: '周静',
        studentId: 'S20231211',
        gender: '女',
        grade: '高二(1)班',
        school: '北苑中学',
        phone: '13300133000',
        parent: '周先生',
        status: '正常上课中',
        enrollmentDate: '2021-09-01',
        teacher: '王老师',
        email: 'zhoujing@example.com',
        birthDate: '2007-02-14',
        address: '北京市朝阳区望京404号',
        householdAddress: '北京市朝阳区望京404号',
        family: [
            { name: '周先生', relation: '父亲', phone: '13300133000', occupation: '设计师' }
        ]
    },
    '吴刚': {
        name: '吴刚',
        studentId: 'S20231212',
        gender: '男',
        grade: '高二(2)班',
        school: '北苑中学',
        phone: '13200132000',
        parent: '吴女士',
        status: '正常上课中',
        enrollmentDate: '2021-09-01',
        teacher: '赵老师',
        email: 'wugang@example.com',
        birthDate: '2007-04-30',
        address: '北京市海淀区清华园505号',
        householdAddress: '北京市海淀区清华园505号',
        family: [
            { name: '吴女士', relation: '母亲', phone: '13200132000', occupation: '科研人员' }
        ]
    },
    '郑秀': {
        name: '郑秀',
        studentId: 'S20231213',
        gender: '女',
        grade: '高二(3)班',
        school: '城东中学',
        phone: '13100131000',
        parent: '郑先生',
        status: '正常上课中',
        enrollmentDate: '2021-09-01',
        teacher: '张老师',
        email: 'zhengxiu@example.com',
        birthDate: '2007-06-18',
        address: '北京市西城区金融街606号',
        householdAddress: '北京市西城区金融街606号',
        family: [
            { name: '郑先生', relation: '父亲', phone: '13100131000', occupation: '金融分析师' }
        ]
    },
    '钱伟': {
        name: '钱伟',
        studentId: 'S20231214',
        gender: '男',
        grade: '高二(4)班',
        school: '北苑中学',
        phone: '13000130000',
        parent: '钱女士',
        status: '请假中',
        enrollmentDate: '2021-09-01',
        teacher: '李老师',
        email: 'qianwei@example.com',
        birthDate: '2007-08-22',
        address: '北京市朝阳区国贸707号',
        householdAddress: '北京市朝阳区国贸707号',
        family: [
            { name: '钱女士', relation: '母亲', phone: '13000130000', occupation: '市场营销' }
        ]
    },
    '冯丽': {
        name: '冯丽',
        studentId: 'S20231215',
        gender: '女',
        grade: '高二(5)班',
        school: '城西中学',
        phone: '15900159000',
        parent: '冯先生',
        status: '正常上课中',
        enrollmentDate: '2021-09-01',
        teacher: '王老师',
        email: 'fengli@example.com',
        birthDate: '2007-10-05',
        address: '北京市海淀区中关村808号',
        householdAddress: '北京市海淀区中关村808号',
        family: [
            { name: '冯先生', relation: '父亲', phone: '15900159000', occupation: '软件工程师' }
        ]
    },
    '陈明': {
        name: '陈明',
        studentId: 'S20231216',
        gender: '男',
        grade: '高一(1)班',
        school: '北苑中学',
        phone: '15800158000',
        parent: '陈女士',
        status: '正常上课中',
        enrollmentDate: '2022-09-01',
        teacher: '赵老师',
        email: 'chenming@example.com',
        birthDate: '2008-12-12',
        address: '北京市朝阳区亚运村909号',
        householdAddress: '北京市朝阳区亚运村909号',
        family: [
            { name: '陈女士', relation: '母亲', phone: '15800158000', occupation: '护士' }
        ]
    },
    '楚云': {
        name: '楚云',
        studentId: 'S20231217',
        gender: '女',
        grade: '高一(2)班',
        school: '北苑中学',
        phone: '15700157000',
        parent: '楚先生',
        status: '正常上课中',
        enrollmentDate: '2022-09-01',
        teacher: '张老师',
        email: 'chuyun@example.com',
        birthDate: '2008-02-28',
        address: '北京市西城区宣武门1010号',
        householdAddress: '北京市西城区宣武门1010号',
        family: [
            { name: '楚先生', relation: '父亲', phone: '15700157000', occupation: '教师' }
        ]
    },
    '魏强': {
        name: '魏强',
        studentId: 'S20231218',
        gender: '男',
        grade: '高一(3)班',
        school: '城东中学',
        phone: '15600156000',
        parent: '魏女士',
        status: '正常上课中',
        enrollmentDate: '2022-09-01',
        teacher: '李老师',
        email: 'weiqiang@example.com',
        birthDate: '2008-05-15',
        address: '北京市丰台区南苑1111号',
        householdAddress: '北京市丰台区南苑1111号',
        family: [
            { name: '魏女士', relation: '母亲', phone: '15600156000', occupation: '销售' }
        ]
    },
    '蒋芳': {
        name: '蒋芳',
        studentId: 'S20231219',
        gender: '女',
        grade: '高一(4)班',
        school: '北苑中学',
        phone: '15500155000',
        parent: '蒋先生',
        status: '正常上课中',
        enrollmentDate: '2022-09-01',
        teacher: '王老师',
        email: 'jiangfang@example.com',
        birthDate: '2008-07-20',
        address: '北京市海淀区万柳1212号',
        householdAddress: '北京市海淀区万柳1212号',
        family: [
            { name: '蒋先生', relation: '父亲', phone: '15500155000', occupation: '项目经理' }
        ]
    },
    '沈浩': {
        name: '沈浩',
        studentId: 'S20231220',
        gender: '男',
        grade: '高一(5)班',
        school: '城西中学',
        phone: '15400154000',
        parent: '沈女士',
        status: '正常上课中',
        enrollmentDate: '2022-09-01',
        teacher: '赵老师',
        email: 'shenhao@example.com',
        birthDate: '2008-09-03',
        address: '北京市朝阳区酒仙桥1313号',
        householdAddress: '北京市朝阳区酒仙桥1313号',
        family: [
            { name: '沈女士', relation: '母亲', phone: '15400154000', occupation: 'HR' }
        ]
    }
};

// Generate data for remaining students from students.html
const remainingStudents = [
    { name: '韩雪', studentId: 'S20231221', gender: '女', grade: '初三(1)班', school: '北苑中学', phone: '15300153000', parent: '韩先生', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '张老师' },
    { name: '杨杰', studentId: 'S20231222', gender: '男', grade: '初三(2)班', school: '北苑中学', phone: '15200152000', parent: '杨女士', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '李老师' },
    { name: '朱琳', studentId: 'S20231223', gender: '女', grade: '初三(3)班', school: '城东中学', phone: '15100151000', parent: '朱先生', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '王老师' },
    { name: '秦涛', studentId: 'S20231224', gender: '男', grade: '初三(4)班', school: '北苑中学', phone: '15000150000', parent: '秦女士', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '赵老师' },
    { name: '尤静', studentId: 'S20231225', gender: '女', grade: '初三(5)班', school: '城西中学', phone: '14900149000', parent: '尤先生', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '张老师' },
    { name: '许强', studentId: 'S20231226', gender: '男', grade: '初二(1)班', school: '北苑中学', phone: '14800148000', parent: '许女士', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '李老师' },
    { name: '何芳', studentId: 'S20231227', gender: '女', grade: '初二(2)班', school: '北苑中学', phone: '14700147000', parent: '何先生', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '王老师' },
    { name: '吕伟', studentId: 'S20231228', gender: '男', grade: '初二(3)班', school: '城东中学', phone: '14600146000', parent: '吕女士', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '赵老师' },
    { name: '施丽', studentId: 'S20231229', gender: '女', grade: '初二(4)班', school: '北苑中学', phone: '14500145000', parent: '施先生', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '张老师' },
    { name: '张浩', studentId: 'S20231230', gender: '男', grade: '初二(5)班', school: '城西中学', phone: '14400144000', parent: '张女士', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '李老师' },
    { name: '孔云', studentId: 'S20231231', gender: '女', grade: '初一(1)班', school: '北苑中学', phone: '14300143000', parent: '孔先生', status: '正常上课中', enrollmentDate: '2025-09-01', teacher: '王老师' },
    { name: '曹杰', studentId: 'S20231232', gender: '男', grade: '初一(2)班', school: '北苑中学', phone: '14200142000', parent: '曹女士', status: '正常上课中', enrollmentDate: '2025-09-01', teacher: '赵老师' },
    { name: '严琳', studentId: 'S20231233', gender: '女', grade: '初一(3)班', school: '城东中学', phone: '14100141000', parent: '严先生', status: '正常上课中', enrollmentDate: '2025-09-01', teacher: '张老师' },
    { name: '华涛', studentId: 'S20231234', gender: '男', grade: '初一(4)班', school: '北苑中学', phone: '14000140000', parent: '华女士', status: '正常上课中', enrollmentDate: '2025-09-01', teacher: '李老师' },
    { name: '金静', studentId: 'S20231235', gender: '女', grade: '初一(5)班', school: '城西中学', phone: '13900139001', parent: '金先生', status: '正常上课中', enrollmentDate: '2025-09-01', teacher: '王老师' },
    { name: '陶芳', studentId: 'S20231236', gender: '女', grade: '六年级(1)班', school: '北苑中学', phone: '13800138001', parent: '陶先生', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '赵老师' },
    { name: '姜伟', studentId: 'S20231237', gender: '男', grade: '六年级(2)班', school: '北苑中学', phone: '13700137001', parent: '姜女士', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '张老师' },
    { name: '戚丽', studentId: 'S20231238', gender: '女', grade: '六年级(3)班', school: '城东中学', phone: '13600136001', parent: '戚先生', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '李老师' },
    { name: '谢浩', studentId: 'S20231239', gender: '男', grade: '六年级(4)班', school: '北苑中学', phone: '13500135001', parent: '谢女士', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '王老师' },
    { name: '邹云', studentId: 'S20231240', gender: '女', grade: '六年级(5)班', school: '城西中学', phone: '13400134001', parent: '邹先生', status: '正常上课中', enrollmentDate: '2024-09-01', teacher: '赵老师' },
    { name: '喻杰', studentId: 'S20231241', gender: '男', grade: '五年级(1)班', school: '北苑中学', phone: '13300133001', parent: '喻女士', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '张老师' },
    { name: '柏琳', studentId: 'S20231242', gender: '女', grade: '五年级(2)班', school: '北苑中学', phone: '13200132001', parent: '柏先生', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '李老师' },
    { name: '水涛', studentId: 'S20231243', gender: '男', grade: '五年级(3)班', school: '城东中学', phone: '13100131001', parent: '水女士', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '王老师' },
    { name: '窦静', studentId: 'S20231244', gender: '女', grade: '五年级(4)班', school: '北苑中学', phone: '13000130001', parent: '窦先生', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '赵老师' },
    { name: '章强', studentId: 'S20231245', gender: '男', grade: '五年级(5)班', school: '城西中学', phone: '15900159001', parent: '章女士', status: '正常上课中', enrollmentDate: '2023-09-01', teacher: '张老师' },
    { name: '云芳', studentId: 'S20231246', gender: '女', grade: '四年级(1)班', school: '北苑中学', phone: '15800158001', parent: '云先生', status: '正常上课中', enrollmentDate: '2022-09-01', teacher: '李老师' },
    { name: '苏伟', studentId: 'S20231247', gender: '男', grade: '四年级(2)班', school: '北苑中学', phone: '15700157001', parent: '苏女士', status: '正常上课中', enrollmentDate: '2022-09-01', teacher: '王老师' },
    { name: '潘丽', studentId: 'S20231248', gender: '女', grade: '四年级(3)班', school: '城东中学', phone: '15600156001', parent: '潘先生', status: '正常上课中', enrollmentDate: '2022-09-01', teacher: '赵老师' },
    { name: '葛浩', studentId: 'S20231249', gender: '男', grade: '四年级(4)班', school: '北苑中学', phone: '15500155001', parent: '葛女士', status: '正常上课中', enrollmentDate: '2022-09-01', teacher: '张老师' },
    { name: '奚云', studentId: 'S20231250', gender: '女', grade: '四年级(5)班', school: '城西中学', phone: '15400154001', parent: '奚先生', status: '正常上课中', enrollmentDate: '2022-09-01', teacher: '李老师' },
    { name: '范杰', studentId: 'S20231251', gender: '男', grade: '三年级(1)班', school: '北苑中学', phone: '15300153001', parent: '范女士', status: '正常上课中', enrollmentDate: '2021-09-01', teacher: '王老师' },
    { name: '彭琳', studentId: 'S20231252', gender: '女', grade: '三年级(2)班', school: '北苑中学', phone: '15200152001', parent: '彭先生', status: '正常上课中', enrollmentDate: '2021-09-01', teacher: '赵老师' },
    { name: '郎涛', studentId: 'S20231253', gender: '男', grade: '三年级(3)班', school: '城东中学', phone: '15100151001', parent: '郎女士', status: '正常上课中', enrollmentDate: '2021-09-01', teacher: '张老师' },
    { name: '鲁静', studentId: 'S20231254', gender: '女', grade: '三年级(4)班', school: '北苑中学', phone: '15000150001', parent: '鲁先生', status: '正常上课中', enrollmentDate: '2021-09-01', teacher: '李老师' },
    { name: '韦强', studentId: 'S20231255', gender: '男', grade: '三年级(5)班', school: '城西中学', phone: '14900149001', parent: '韦女士', status: '正常上课中', enrollmentDate: '2021-09-01', teacher: '王老师' },
    { name: '昌芳', studentId: 'S20231256', gender: '女', grade: '二年级(1)班', school: '北苑中学', phone: '14800148001', parent: '昌先生', status: '正常上课中', enrollmentDate: '2020-09-01', teacher: '赵老师' },
    { name: '马伟', studentId: 'S20231257', gender: '男', grade: '二年级(2)班', school: '北苑中学', phone: '14700147001', parent: '马女士', status: '正常上课中', enrollmentDate: '2020-09-01', teacher: '张老师' },
    { name: '苗丽', studentId: 'S20231258', gender: '女', grade: '二年级(3)班', school: '城东中学', phone: '14600146001', parent: '苗先生', status: '正常上课中', enrollmentDate: '2020-09-01', teacher: '李老师' },
    { name: '凤浩', studentId: 'S20231259', gender: '男', grade: '二年级(4)班', school: '北苑中学', phone: '14500145001', parent: '凤女士', status: '正常上课中', enrollmentDate: '200-09-01', teacher: '王老师' },
    { name: '花云', studentId: 'S20231260', gender: '女', grade: '二年级(5)班', school: '城西中学', phone: '14400144001', parent: '花先生', status: '正常上课中', enrollmentDate: '2020-09-01', teacher: '赵老师' }
];

// Add remaining students with default values
remainingStudents.forEach(student => {
    if (!allStudentsData[student.name]) {
        // Calculate birth date based on grade
        let birthYear = 2010;
        if (student.grade.includes('高三')) birthYear = 2006;
        else if (student.grade.includes('高二')) birthYear = 2007;
        else if (student.grade.includes('高一')) birthYear = 2008;
        else if (student.grade.includes('初三')) birthYear = 2009;
        else if (student.grade.includes('初二')) birthYear = 2010;
        else if (student.grade.includes('初一')) birthYear = 2011;
        else if (student.grade.includes('六年级')) birthYear = 2012;
        else if (student.grade.includes('五年级')) birthYear = 2013;
        else if (student.grade.includes('四年级')) birthYear = 2014;
        else if (student.grade.includes('三年级')) birthYear = 2015;
        else if (student.grade.includes('二年级')) birthYear = 2016;
        else if (student.grade.includes('一年级')) birthYear = 2017;

        allStudentsData[student.name] = {
            ...student,
            email: `${student.name.toLowerCase()}@example.com`,
            birthDate: `${birthYear}-03-18`,
            address: `北京市${student.school.includes('北苑') ? '海淀区' : student.school.includes('城东') ? '西城区' : '朝阳区'}${student.name}路${Math.floor(Math.random() * 1000) + 100}号`,
            householdAddress: `北京市${student.school.includes('北苑') ? '海淀区' : student.school.includes('城东') ? '西城区' : '朝阳区'}${student.name}路${Math.floor(Math.random() * 1000) + 100}号`,
            family: [
                { name: student.parent, relation: '家长', phone: student.phone, occupation: '-' }
            ]
        };
    }
});

// Add students from program.html that don't exist in students.html
const programStudents = [
    // From math-elementary
    { name: '陈小华', studentId: 'S2024101001', grade: '三年级(1)班', school: '北苑小学', parent: '陈先生', phone: '13800138001', status: '正常上课中', gender: '男', teacher: '张老师', enrollmentDate: '2022-09-01' },
    { name: '王小敏', studentId: 'S2024101002', grade: '三年级(2)班', school: '北苑小学', parent: '王女士', phone: '13800138002', status: '正常上课中', gender: '女', teacher: '李老师', enrollmentDate: '2022-09-01' },
    { name: '张小强', studentId: 'S2024101003', grade: '四年级(1)班', school: '城东小学', parent: '张先生', phone: '13800138003', status: '正常上课中', gender: '男', teacher: '王老师', enrollmentDate: '2021-09-01' },
    { name: '李小红', studentId: 'S2024101004', grade: '四年级(2)班', school: '北苑小学', parent: '李女士', phone: '13800138004', status: '正常上课中', gender: '女', teacher: '赵老师', enrollmentDate: '2021-09-01' },
    { name: '刘小刚', studentId: 'S2024101005', grade: '五年级(1)班', school: '城西小学', parent: '刘先生', phone: '13800138005', status: '正常上课中', gender: '男', teacher: '张老师', enrollmentDate: '2020-09-01' },
    // From math-middle
    { name: '赵小明', studentId: 'S2024102001', grade: '初一(1)班', school: '北苑中学', parent: '赵先生', phone: '13800138006', status: '正常上课中', gender: '男', teacher: '李老师', enrollmentDate: '2024-09-01' },
    { name: '钱小芳', studentId: 'S2024102002', grade: '初一(2)班', school: '北苑中学', parent: '钱女士', phone: '13800138007', status: '正常上课中', gender: '女', teacher: '王老师', enrollmentDate: '2024-09-01' },
    { name: '孙小亮', studentId: 'S2024102003', grade: '初二(1)班', school: '城东中学', parent: '孙先生', phone: '13800138008', status: '正常上课中', gender: '男', teacher: '赵老师', enrollmentDate: '2023-09-01' },
    { name: '周小丽', studentId: 'S2024102004', grade: '初二(2)班', school: '北苑中学', parent: '周女士', phone: '13800138009', status: '请假中', gender: '女', teacher: '张老师', enrollmentDate: '2023-09-01' },
    { name: '吴小军', studentId: 'S2024102005', grade: '初三(1)班', school: '城西中学', parent: '吴先生', phone: '13800138010', status: '正常上课中', gender: '男', teacher: '李老师', enrollmentDate: '2022-09-01' },
    // From math-high
    { name: '郑小波', studentId: 'S2024103001', grade: '高一(1)班', school: '北苑中学', parent: '郑先生', phone: '13800138011', status: '正常上课中', gender: '男', teacher: '王老师', enrollmentDate: '2023-09-01' },
    { name: '王小明', studentId: 'S2024103002', grade: '高一(2)班', school: '北苑中学', parent: '王先生', phone: '13800138012', status: '正常上课中', gender: '男', teacher: '赵老师', enrollmentDate: '2023-09-01' },
    { name: '冯小霞', studentId: 'S2024103003', grade: '高二(1)班', school: '城东中学', parent: '冯女士', phone: '13800138013', status: '正常上课中', gender: '女', teacher: '张老师', enrollmentDate: '2022-09-01' },
    { name: '陈小勇', studentId: 'S2024103004', grade: '高二(2)班', school: '北苑中学', parent: '陈先生', phone: '13800138014', status: '正常上课中', gender: '男', teacher: '李老师', enrollmentDate: '2022-09-01' },
    { name: '楚小云', studentId: 'S2024103005', grade: '高三(1)班', school: '城西中学', parent: '楚女士', phone: '13800138015', status: '正常上课中', gender: '女', teacher: '王老师', enrollmentDate: '2021-09-01' },
    // From english-speaking
    { name: '魏小涛', studentId: 'S2024104001', grade: '初一(3)班', school: '北苑中学', parent: '魏先生', phone: '13800138016', status: '正常上课中', gender: '男', teacher: '赵老师', enrollmentDate: '2024-09-01' },
    { name: '蒋小静', studentId: 'S2024104002', grade: '初二(3)班', school: '北苑中学', parent: '蒋女士', phone: '13800138017', status: '正常上课中', gender: '女', teacher: '张老师', enrollmentDate: '2023-09-01' },
    { name: '沈小浩', studentId: 'S2024104003', grade: '初三(2)班', school: '城东中学', parent: '沈先生', phone: '13800138018', status: '正常上课中', gender: '男', teacher: '李老师', enrollmentDate: '2022-09-01' },
    { name: '韩小雪', studentId: 'S2024104004', grade: '高一(3)班', school: '北苑中学', parent: '韩女士', phone: '13800138019', status: '正常上课中', gender: '女', teacher: '王老师', enrollmentDate: '2023-09-01' },
    { name: '杨小杰', studentId: 'S2024104005', grade: '高二(3)班', school: '城西中学', parent: '杨先生', phone: '13800138020', status: '正常上课中', gender: '男', teacher: '赵老师', enrollmentDate: '2022-09-01' }
];

programStudents.forEach(student => {
    if (!allStudentsData[student.name]) {
        let birthYear = 2010;
        if (student.grade.includes('高三')) birthYear = 2006;
        else if (student.grade.includes('高二')) birthYear = 2007;
        else if (student.grade.includes('高一')) birthYear = 2008;
        else if (student.grade.includes('初三')) birthYear = 2009;
        else if (student.grade.includes('初二')) birthYear = 2010;
        else if (student.grade.includes('初一')) birthYear = 2011;
        else if (student.grade.includes('六年级')) birthYear = 2012;
        else if (student.grade.includes('五年级')) birthYear = 2013;
        else if (student.grade.includes('四年级')) birthYear = 2014;
        else if (student.grade.includes('三年级')) birthYear = 2015;
        else if (student.grade.includes('二年级')) birthYear = 2016;
        else if (student.grade.includes('一年级')) birthYear = 2017;

        allStudentsData[student.name] = {
            ...student,
            email: `${student.name.toLowerCase()}@example.com`,
            birthDate: `${birthYear}-03-18`,
            address: `北京市${student.school.includes('北苑') ? '海淀区' : student.school.includes('城东') ? '西城区' : '朝阳区'}${student.name}路${Math.floor(Math.random() * 1000) + 100}号`,
            householdAddress: `北京市${student.school.includes('北苑') ? '海淀区' : student.school.includes('城东') ? '西城区' : '朝阳区'}${student.name}路${Math.floor(Math.random() * 1000) + 100}号`,
            family: [
                { name: student.parent, relation: '家长', phone: student.phone, occupation: '-' }
            ]
        };
    }
});

// Student schedules data - detailed schedules for key students (from program.html)
const studentSchedulesData = {
    '李明轩': {
        name: '李明轩',
        monday: {
            morning: { course: '高考化学冲刺班', time: '09:30-11:30', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' },
            afternoon: null,
            evening: { course: '高中数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '已签到', color: 'red' }
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高中物理精讲班', time: '19:00-21:00', teacher: '王老师', room: 'B105', status: '待签到', color: 'green' }
        },
        wednesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高中数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '已签到', color: 'red' }
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高中物理精讲班', time: '19:00-21:00', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' }
        },
        friday: {
            morning: null,
            afternoon: null,
            evening: { course: '高中数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '待签到', color: 'red' }
        },
        saturday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '张雨': {
        name: '张雨',
        monday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        tuesday: {
            morning: null,
            afternoon: { course: '高考物理强化班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: null
        },
        wednesday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: { course: '高考物理强化班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        friday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '待签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '王浩': {
        name: '王浩',
        monday: {
            morning: null,
            afternoon: { course: '高考化学冲刺班', time: '14:30-17:00', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' },
            evening: null
        },
        tuesday: {
            morning: { course: '高考生物精讲班', time: '09:00-11:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            afternoon: null,
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        wednesday: {
            morning: null,
            afternoon: { course: '高考化学冲刺班', time: '14:30-17:00', teacher: '陈老师', room: 'C103', status: '待签到', color: 'amber' },
            evening: null
        },
        thursday: {
            morning: { course: '高考生物精讲班', time: '09:00-11:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            afternoon: null,
            evening: null
        },
        friday: {
            morning: null,
            afternoon: { course: '高考化学冲刺班', time: '14:30-17:00', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' },
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '待签到', color: 'amber' }
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '陈晓': {
        name: '陈晓',
        monday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考语文强化班', time: '14:00-16:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' },
            evening: null
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' }
        },
        wednesday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考语文强化班', time: '14:00-16:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' },
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '待签到', color: 'purple' }
        },
        friday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '赵婷': {
        name: '赵婷',
        monday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        tuesday: {
            morning: { course: '高考历史精讲班', time: '09:00-11:30', teacher: '孙老师', room: 'A208', status: '已签到', color: 'orange' },
            afternoon: null,
            evening: null
        },
        wednesday: {
            morning: null,
            afternoon: { course: '高考地理强化班', time: '14:00-16:30', teacher: '周老师', room: 'A210', status: '已签到', color: 'teal' },
            evening: null
        },
        thursday: {
            morning: { course: '高考历史精讲班', time: '09:00-11:30', teacher: '孙老师', room: 'A208', status: '已签到', color: 'orange' },
            afternoon: null,
            evening: null
        },
        friday: {
            morning: null,
            afternoon: { course: '高考地理强化班', time: '14:00-16:30', teacher: '周老师', room: 'A210', status: '待签到', color: 'teal' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '刘强': {
        name: '刘强',
        monday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考数学冲刺班', time: '14:00-17:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            evening: { course: '高考物理精讲班', time: '18:30-20:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' }
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考物理精讲班', time: '18:30-20:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' }
        },
        wednesday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考数学冲刺班', time: '14:00-17:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考物理精讲班', time: '18:30-20:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' }
        },
        friday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考数学冲刺班', time: '14:00-17:00', teacher: '李老师', room: 'A201', status: '待签到', color: 'blue' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '周静': {
        name: '周静',
        monday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考化学冲刺班', time: '18:00-20:00', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        tuesday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        wednesday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考物理强化班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: { course: '高考化学冲刺班', time: '18:00-20:00', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        thursday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        friday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '待签到', color: 'blue' },
            afternoon: { course: '高考物理强化班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '吴刚': {
        name: '吴刚',
        monday: {
            morning: null,
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: { course: '高考数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '已签到', color: 'red' }
        },
        tuesday: {
            morning: { course: '高考物理精讲班', time: '09:00-11:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            afternoon: null,
            evening: { course: '高考数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '已签到', color: 'red' }
        },
        wednesday: {
            morning: null,
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        thursday: {
            morning: { course: '高考物理精讲班', time: '09:00-11:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            afternoon: null,
            evening: { course: '高考数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '待签到', color: 'red' }
        },
        friday: {
            morning: null,
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '郑秀': {
        name: '郑秀',
        monday: {
            morning: { course: '高考语文强化班', time: '08:30-11:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            evening: null
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' }
        },
        wednesday: {
            morning: { course: '高考语文强化班', time: '08:30-11:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '待签到', color: 'purple' }
        },
        friday: {
            morning: { course: '高考语文强化班', time: '08:30-11:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '钱伟': {
        name: '钱伟',
        monday: {
            morning: { course: '高考数学冲刺班', time: '09:00-12:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        tuesday: {
            morning: null,
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        wednesday: {
            morning: { course: '高考数学冲刺班', time: '09:00-12:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '待签到', color: 'amber' }
        },
        friday: {
            morning: { course: '高考数学冲刺班', time: '09:00-12:00', teacher: '李老师', room: 'A201', status: '待签到', color: 'blue' },
            afternoon: null,
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '冯丽': {
        name: '冯丽',
        monday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考生物精讲班', time: '14:00-16:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            evening: null
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考生物精讲班', time: '18:30-20:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' }
        },
        wednesday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考生物精讲班', time: '14:00-16:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考生物精讲班', time: '18:30-20:30', teacher: '赵老师', room: 'C205', status: '待签到', color: 'green' }
        },
        friday: {
            morning: { course: '高考英语特训营', time: '08:30-11:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: { course: '高考生物精讲班', time: '14:00-16:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '陈明': {
        name: '陈明',
        monday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考物理精讲班', time: '18:30-20:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' }
        },
        tuesday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考物理精讲班', time: '18:30-20:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' }
        },
        wednesday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        thursday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考物理精讲班', time: '18:30-20:30', teacher: '王老师', room: 'B105', status: '待签到', color: 'green' }
        },
        friday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '楚云': {
        name: '楚云',
        monday: {
            morning: null,
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' }
        },
        tuesday: {
            morning: { course: '高考历史精讲班', time: '09:00-11:30', teacher: '孙老师', room: 'A208', status: '已签到', color: 'orange' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        wednesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '已签到', color: 'purple' }
        },
        thursday: {
            morning: { course: '高考历史精讲班', time: '09:00-11:30', teacher: '孙老师', room: 'A208', status: '已签到', color: 'orange' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        friday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考语文强化班', time: '18:30-20:30', teacher: '刘老师', room: 'A105', status: '待签到', color: 'purple' }
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '魏强': {
        name: '魏强',
        monday: {
            morning: { course: '高考物理精讲班', time: '09:00-12:00', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            afternoon: { course: '高考数学冲刺班', time: '14:00-17:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        wednesday: {
            morning: { course: '高考物理精讲班', time: '09:00-12:00', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            afternoon: { course: '高考数学冲刺班', time: '14:00-17:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        friday: {
            morning: { course: '高考物理精讲班', time: '09:00-12:00', teacher: '王老师', room: 'B105', status: '待签到', color: 'green' },
            afternoon: { course: '高考数学冲刺班', time: '14:00-17:00', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '蒋芳': {
        name: '蒋芳',
        monday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        tuesday: {
            morning: { course: '高考生物精讲班', time: '09:00-11:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        wednesday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '已签到', color: 'amber' }
        },
        thursday: {
            morning: { course: '高考生物精讲班', time: '09:00-11:30', teacher: '赵老师', room: 'C205', status: '已签到', color: 'green' },
            afternoon: { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'purple' },
            evening: null
        },
        friday: {
            morning: { course: '高考英语特训营', time: '09:00-12:00', teacher: '张老师', room: 'A302', status: '待签到', color: 'blue' },
            afternoon: null,
            evening: { course: '高考化学冲刺班', time: '18:30-20:30', teacher: '陈老师', room: 'C103', status: '待签到', color: 'amber' }
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    },
    '沈浩': {
        name: '沈浩',
        monday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: { course: '高考物理精讲班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        tuesday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        wednesday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' },
            afternoon: { course: '高考物理精讲班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: null
        },
        thursday: {
            morning: null,
            afternoon: null,
            evening: { course: '高考英语特训营', time: '18:00-20:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' }
        },
        friday: {
            morning: { course: '高考数学冲刺班', time: '08:30-11:30', teacher: '李老师', room: 'A201', status: '待签到', color: 'blue' },
            afternoon: { course: '高考物理精讲班', time: '14:00-16:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' },
            evening: null
        },
        saturday: {
            morning: null,
            afternoon: null,
            evening: null
        },
        sunday: {
            morning: null,
            afternoon: null,
            evening: null
        }
    }
};

/**
 * Generate schedule for a student based on their grade
 * @param {Object} student - Student data object
 * @returns {Object} Schedule object
 */
function generateScheduleForStudent(student) {
    const grade = student.grade || '';
    const schedule = {
        name: student.name,
        studentId: student.studentId,
        monday: { morning: null, afternoon: null, evening: null },
        tuesday: { morning: null, afternoon: null, evening: null },
        wednesday: { morning: null, afternoon: null, evening: null },
        thursday: { morning: null, afternoon: null, evening: null },
        friday: { morning: null, afternoon: null, evening: null },
        saturday: { morning: null, afternoon: null, evening: null },
        sunday: { morning: null, afternoon: null, evening: null }
    };
    
    if (grade.includes('高三')) {
        schedule.monday.morning = { course: '高考数学冲刺班', time: '08:30-11:30', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
        schedule.wednesday.morning = { course: '高考数学冲刺班', time: '08:30-11:30', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
        schedule.friday.morning = { course: '高考数学冲刺班', time: '08:30-11:30', teacher: student.teacher, room: 'A201', status: '待签到', color: 'blue' };
        schedule.tuesday.afternoon = { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
        schedule.thursday.afternoon = { course: '高考英语特训营', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
    } else if (grade.includes('高二')) {
        schedule.monday.evening = { course: '高中数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '已签到', color: 'red' };
        schedule.wednesday.evening = { course: '高中数学强化训练', time: '18:30-20:30', teacher: '刘老师', room: 'B201', status: '已签到', color: 'red' };
        schedule.tuesday.morning = { course: '高中物理精讲班', time: '09:00-11:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' };
        schedule.thursday.morning = { course: '高中物理精讲班', time: '09:00-11:30', teacher: '王老师', room: 'B105', status: '已签到', color: 'green' };
    } else if (grade.includes('高一')) {
        schedule.monday.afternoon = { course: '高中英语基础班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
        schedule.wednesday.afternoon = { course: '高中英语基础班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
        schedule.friday.afternoon = { course: '高中英语基础班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '待签到', color: 'blue' };
    } else if (grade.includes('初三')) {
        schedule.monday.morning = { course: '中考数学冲刺班', time: '09:00-12:00', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
        schedule.wednesday.morning = { course: '中考数学冲刺班', time: '09:00-12:00', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
        schedule.tuesday.afternoon = { course: '中考英语强化班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
        schedule.thursday.afternoon = { course: '中考英语强化班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
    } else if (grade.includes('初二')) {
        schedule.monday.evening = { course: '初中数学强化班', time: '18:30-20:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' };
        schedule.wednesday.evening = { course: '初中数学强化班', time: '18:30-20:30', teacher: '李老师', room: 'A201', status: '已签到', color: 'blue' };
    } else if (grade.includes('初一')) {
        schedule.tuesday.afternoon = { course: '初中英语基础班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
        schedule.thursday.afternoon = { course: '初中英语基础班', time: '14:00-16:30', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
    } else if (grade.includes('六年级')) {
        schedule.saturday.morning = { course: '小升初数学强化班', time: '09:00-12:00', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
        schedule.saturday.afternoon = { course: '小升初英语强化班', time: '14:00-17:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
    } else if (grade.includes('五年级')) {
        schedule.saturday.morning = { course: '小学数学思维训练', time: '09:00-11:30', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
    } else if (grade.includes('四年级')) {
        schedule.saturday.afternoon = { course: '小学英语基础班', time: '14:00-16:00', teacher: '张老师', room: 'A302', status: '已签到', color: 'blue' };
    } else if (grade.includes('三年级')) {
        schedule.saturday.morning = { course: '小学数学兴趣班', time: '09:00-11:00', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
    } else if (grade.includes('二年级') || grade.includes('一年级')) {
        schedule.saturday.morning = { course: '小学趣味数学', time: '09:00-10:30', teacher: student.teacher, room: 'A201', status: '已签到', color: 'blue' };
    }
    
    return schedule;
}

/**
 * Get student schedule - returns detailed schedule if available, otherwise generates one
 * @param {string} studentName - Student name
 * @returns {Object} Schedule object
 */
function getStudentSchedule(studentName) {
    const student = allStudentsData[studentName];
    if (!student) {
        return null;
    }
    
    // If detailed schedule exists, use it and update studentId
    if (studentSchedulesData[studentName]) {
        const schedule = { ...studentSchedulesData[studentName] };
        schedule.studentId = student.studentId;
        return schedule;
    }
    
    // Otherwise, generate schedule based on grade
    return generateScheduleForStudent(student);
}

/**
 * Build complete student schedules object for all students
 * @returns {Object} Complete student schedules object
 */
function buildStudentSchedules() {
    const schedules = {};
    
    // Add detailed schedules for students that have them
    Object.keys(studentSchedulesData).forEach(name => {
        const student = allStudentsData[name];
        if (student) {
            schedules[name] = { ...studentSchedulesData[name] };
            schedules[name].studentId = student.studentId;
        }
    });
    
    // Generate schedules for remaining students
    Object.keys(allStudentsData).forEach(name => {
        if (!schedules[name]) {
            schedules[name] = generateScheduleForStudent(allStudentsData[name]);
        }
    });
    
    return schedules;
}

// Program data - courses and their students (from program.html)
// If programData already exists on window (from program.html), use it directly
// Otherwise create new programData object
// Use a temporary variable to avoid conflicts, then assign to window
let tempProgramData;
if (window.programData && typeof window.programData === 'object') {
    // Use existing programData from window (don't redeclare, just reference it)
    tempProgramData = window.programData;
    console.log('Using existing window.programData');
} else {
    // Create new programData object
    console.log('Creating new programData object');
    tempProgramData = {
    'math-elementary': {
        id: 'math-elementary',
        name: '小学数学思维训练',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '陈小华', studentId: 'S2024101001', grade: '三年级(1)班', school: '北苑小学', parent: '陈先生', phone: '13800138001', status: '正常上课中', gender: '男' },
            { name: '王小敏', studentId: 'S2024101002', grade: '三年级(2)班', school: '北苑小学', parent: '王女士', phone: '13800138002', status: '正常上课中', gender: '女' },
            { name: '张小强', studentId: 'S2024101003', grade: '四年级(1)班', school: '城东小学', parent: '张先生', phone: '13800138003', status: '正常上课中', gender: '男' },
            { name: '李小红', studentId: 'S2024101004', grade: '四年级(2)班', school: '北苑小学', parent: '李女士', phone: '13800138004', status: '正常上课中', gender: '女' },
            { name: '刘小刚', studentId: 'S2024101005', grade: '五年级(1)班', school: '城西小学', parent: '刘先生', phone: '13800138005', status: '正常上课中', gender: '男' }
        ]
    },
    'math-middle': {
        id: 'math-middle',
        name: '初中数学强化班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '赵小明', studentId: 'S2024102001', grade: '初一(1)班', school: '北苑中学', parent: '赵先生', phone: '13800138006', status: '正常上课中', gender: '男' },
            { name: '钱小芳', studentId: 'S2024102002', grade: '初一(2)班', school: '北苑中学', parent: '钱女士', phone: '13800138007', status: '正常上课中', gender: '女' },
            { name: '孙小亮', studentId: 'S2024102003', grade: '初二(1)班', school: '城东中学', parent: '孙先生', phone: '13800138008', status: '正常上课中', gender: '男' },
            { name: '周小丽', studentId: 'S2024102004', grade: '初二(2)班', school: '北苑中学', parent: '周女士', phone: '13800138009', status: '请假中', gender: '女' },
            { name: '吴小军', studentId: 'S2024102005', grade: '初三(1)班', school: '城西中学', parent: '吴先生', phone: '13800138010', status: '正常上课中', gender: '男' }
        ]
    },
    'math-high': {
        id: 'math-high',
        name: '高中数学强化训练',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '郑小波', studentId: 'S2024103001', grade: '高一(1)班', school: '北苑中学', parent: '郑先生', phone: '13800138011', status: '正常上课中', gender: '男' },
            { name: '王小明', studentId: 'S2024103002', grade: '高一(2)班', school: '北苑中学', parent: '王先生', phone: '13800138012', status: '正常上课中', gender: '男' },
            { name: '冯小霞', studentId: 'S2024103003', grade: '高二(1)班', school: '城东中学', parent: '冯女士', phone: '13800138013', status: '正常上课中', gender: '女' },
            { name: '陈小勇', studentId: 'S2024103004', grade: '高二(2)班', school: '北苑中学', parent: '陈先生', phone: '13800138014', status: '正常上课中', gender: '男' },
            { name: '楚小云', studentId: 'S2024103005', grade: '高三(1)班', school: '城西中学', parent: '楚女士', phone: '13800138015', status: '正常上课中', gender: '女' }
        ]
    },
    'english-speaking': {
        id: 'english-speaking',
        name: '英语口语班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '魏小涛', studentId: 'S2024104001', grade: '初一(3)班', school: '北苑中学', parent: '魏先生', phone: '13800138016', status: '正常上课中', gender: '男' },
            { name: '蒋小静', studentId: 'S2024104002', grade: '初二(3)班', school: '北苑中学', parent: '蒋女士', phone: '13800138017', status: '正常上课中', gender: '女' },
            { name: '沈小浩', studentId: 'S2024104003', grade: '初三(2)班', school: '城东中学', parent: '沈先生', phone: '13800138018', status: '正常上课中', gender: '男' },
            { name: '韩小雪', studentId: 'S2024104004', grade: '高一(3)班', school: '北苑中学', parent: '韩女士', phone: '13800138019', status: '正常上课中', gender: '女' },
            { name: '杨小杰', studentId: 'S2024104005', grade: '高二(3)班', school: '城西中学', parent: '杨先生', phone: '13800138020', status: '正常上课中', gender: '男' }
        ]
    },
    'english-gaokao': {
        id: 'english-gaokao',
        name: '高考英语特训营',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '李明轩', studentId: 'S20231205', grade: '高三(3)班', school: '北苑中学', parent: '李先生', phone: '13800138000', status: '正常上课中', gender: '男' },
            { name: '张雨', studentId: 'S20231206', grade: '高三(1)班', school: '北苑中学', parent: '张女士', phone: '13900139000', status: '正常上课中', gender: '女' },
            { name: '王浩', studentId: 'S20231207', grade: '高三(3)班', school: '北苑中学', parent: '王先生', phone: '13700137000', status: '请假中', gender: '男' },
            { name: '陈晓', studentId: 'S20231208', grade: '高三(4)班', school: '城东中学', parent: '陈先生', phone: '13600136000', status: '正常上课中', gender: '女' },
            { name: '赵婷', studentId: 'S20231209', grade: '高三(2)班', school: '北苑中学', parent: '赵女士', phone: '13500135000', status: '正常上课中', gender: '女' },
            { name: '刘强', studentId: 'S20231210', grade: '高三(5)班', school: '城西中学', parent: '刘先生', phone: '13400134000', status: '正常上课中', gender: '男' },
            { name: '周静', studentId: 'S20231211', grade: '高二(1)班', school: '北苑中学', parent: '周先生', phone: '13300133000', status: '正常上课中', gender: '女' },
            { name: '吴刚', studentId: 'S20231212', grade: '高二(2)班', school: '北苑中学', parent: '吴女士', phone: '13200132000', status: '正常上课中', gender: '男' },
            { name: '郑秀', studentId: 'S20231213', grade: '高二(3)班', school: '城东中学', parent: '郑先生', phone: '13100131000', status: '正常上课中', gender: '女' },
            { name: '钱伟', studentId: 'S20231214', grade: '高二(4)班', school: '北苑中学', parent: '钱女士', phone: '13000130000', status: '请假中', gender: '男' },
            { name: '冯丽', studentId: 'S20231215', grade: '高二(5)班', school: '城西中学', parent: '冯先生', phone: '15900159000', status: '正常上课中', gender: '女' },
            { name: '陈明', studentId: 'S20231216', grade: '高一(1)班', school: '北苑中学', parent: '陈女士', phone: '15800158000', status: '正常上课中', gender: '男' },
            { name: '楚云', studentId: 'S20231217', grade: '高一(2)班', school: '北苑中学', parent: '楚先生', phone: '15700157000', status: '正常上课中', gender: '女' },
            { name: '魏强', studentId: 'S20231218', grade: '高一(3)班', school: '城东中学', parent: '魏女士', phone: '15600156000', status: '正常上课中', gender: '男' },
            { name: '蒋芳', studentId: 'S20231219', grade: '高一(4)班', school: '北苑中学', parent: '蒋先生', phone: '15500155000', status: '正常上课中', gender: '女' },
            { name: '沈浩', studentId: 'S20231220', grade: '高一(5)班', school: '城西中学', parent: '沈女士', phone: '15400154000', status: '正常上课中', gender: '男' }
        ]
    },
    'art-painting': {
        id: 'art-painting',
        name: '绘画基础班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '韩小雪', studentId: 'S2024105001', grade: '一年级(1)班', school: '北苑小学', parent: '韩先生', phone: '13800138021', status: '正常上课中', gender: '女' },
            { name: '杨小杰', studentId: 'S2024105002', grade: '一年级(2)班', school: '城东小学', parent: '杨女士', phone: '13800138022', status: '正常上课中', gender: '男' },
            { name: '朱小琳', studentId: 'S2024105003', grade: '二年级(1)班', school: '北苑小学', parent: '朱先生', phone: '13800138023', status: '正常上课中', gender: '女' },
            { name: '秦小涛', studentId: 'S2024105004', grade: '二年级(2)班', school: '城西小学', parent: '秦女士', phone: '13800138024', status: '正常上课中', gender: '男' }
        ]
    },
    'art-sketch': {
        id: 'art-sketch',
        name: '素描进阶班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '尤小静', studentId: 'S2024106001', grade: '三年级(3)班', school: '北苑小学', parent: '尤先生', phone: '13800138025', status: '正常上课中', gender: '女' },
            { name: '许小强', studentId: 'S2024106002', grade: '四年级(3)班', school: '城东小学', parent: '许女士', phone: '13800138026', status: '正常上课中', gender: '男' },
            { name: '何小芳', studentId: 'S2024106003', grade: '五年级(2)班', school: '北苑小学', parent: '何先生', phone: '13800138027', status: '正常上课中', gender: '女' }
        ]
    },
    'art-watercolor': {
        id: 'art-watercolor',
        name: '水彩画班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '吕小伟', studentId: 'S2024107001', grade: '四年级(4)班', school: '城西小学', parent: '吕先生', phone: '13800138028', status: '正常上课中', gender: '男' },
            { name: '施小丽', studentId: 'S2024107002', grade: '五年级(3)班', school: '北苑小学', parent: '施女士', phone: '13800138029', status: '正常上课中', gender: '女' },
            { name: '张小浩', studentId: 'S2024107003', grade: '六年级(1)班', school: '城东小学', parent: '张先生', phone: '13800138030', status: '正常上课中', gender: '男' }
        ]
    },
    'music-piano': {
        id: 'music-piano',
        name: '钢琴基础班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '孔小云', studentId: 'S2024108001', grade: '一年级(3)班', school: '北苑小学', parent: '孔先生', phone: '13800138031', status: '正常上课中', gender: '女' },
            { name: '曹小杰', studentId: 'S2024108002', grade: '二年级(3)班', school: '城西小学', parent: '曹女士', phone: '13800138032', status: '正常上课中', gender: '男' },
            { name: '严小琳', studentId: 'S2024108003', grade: '三年级(4)班', school: '北苑小学', parent: '严先生', phone: '13800138033', status: '正常上课中', gender: '女' }
        ]
    },
    'music-vocal': {
        id: 'music-vocal',
        name: '声乐训练班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '华小涛', studentId: 'S2024109001', grade: '四年级(5)班', school: '城东小学', parent: '华先生', phone: '13800138034', status: '正常上课中', gender: '男' },
            { name: '金小静', studentId: 'S2024109002', grade: '五年级(4)班', school: '北苑小学', parent: '金女士', phone: '13800138035', status: '正常上课中', gender: '女' },
            { name: '陶小芳', studentId: 'S2024109003', grade: '六年级(2)班', school: '城西小学', parent: '陶先生', phone: '13800138036', status: '正常上课中', gender: '女' }
        ]
    },
    'science-physics': {
        id: 'science-physics',
        name: '物理实验班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '姜小伟', studentId: 'S2024110001', grade: '初二(4)班', school: '北苑中学', parent: '姜先生', phone: '13800138037', status: '正常上课中', gender: '男' },
            { name: '戚小丽', studentId: 'S2024110002', grade: '初三(3)班', school: '城东中学', parent: '戚女士', phone: '13800138038', status: '正常上课中', gender: '女' },
            { name: '谢小浩', studentId: 'S2024110003', grade: '高一(4)班', school: '北苑中学', parent: '谢先生', phone: '13800138039', status: '正常上课中', gender: '男' },
            { name: '邹小云', studentId: 'S2024110004', grade: '高二(4)班', school: '城西中学', parent: '邹女士', phone: '13800138040', status: '正常上课中', gender: '女' }
        ]
    },
    'science-chemistry': {
        id: 'science-chemistry',
        name: '化学实验班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '喻小杰', studentId: 'S2024111001', grade: '初三(4)班', school: '北苑中学', parent: '喻先生', phone: '13800138041', status: '正常上课中', gender: '男' },
            { name: '柏小琳', studentId: 'S2024111002', grade: '高一(5)班', school: '城东中学', parent: '柏女士', phone: '13800138042', status: '正常上课中', gender: '女' },
            { name: '水小涛', studentId: 'S2024111003', grade: '高二(5)班', school: '北苑中学', parent: '水先生', phone: '13800138043', status: '正常上课中', gender: '男' },
            { name: '窦小静', studentId: 'S2024111004', grade: '高三(6)班', school: '城西中学', parent: '窦女士', phone: '13800138044', status: '正常上课中', gender: '女' }
        ]
    },
    'science-biology': {
        id: 'science-biology',
        name: '生物实验班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '章小强', studentId: 'S2024112001', grade: '高一(6)班', school: '北苑中学', parent: '章先生', phone: '13800138045', status: '正常上课中', gender: '男' },
            { name: '云小芳', studentId: 'S2024112002', grade: '高二(6)班', school: '城东中学', parent: '云女士', phone: '13800138046', status: '正常上课中', gender: '女' },
            { name: '苏小伟', studentId: 'S2024112003', grade: '高三(7)班', school: '北苑中学', parent: '苏先生', phone: '13800138047', status: '正常上课中', gender: '男' }
        ]
    },
    'science-robotics': {
        id: 'science-robotics',
        name: '机器人编程班',
        semester: '2025年秋季学期 (9月-12月)',
        students: [
            { name: '潘小丽', studentId: 'S2024113001', grade: '初一(4)班', school: '北苑中学', parent: '潘先生', phone: '13800138048', status: '正常上课中', gender: '女' },
            { name: '葛小浩', studentId: 'S2024113002', grade: '初二(5)班', school: '城东中学', parent: '葛女士', phone: '13800138049', status: '正常上课中', gender: '男' },
            { name: '奚小云', studentId: 'S2024113003', grade: '初三(5)班', school: '北苑中学', parent: '奚先生', phone: '13800138050', status: '正常上课中', gender: '女' },
            { name: '范小杰', studentId: 'S2024113004', grade: '高一(7)班', school: '城西中学', parent: '范女士', phone: '13800138051', status: '正常上课中', gender: '男' },
            { name: '彭小琳', studentId: 'S2024113005', grade: '高二(7)班', school: '北苑中学', parent: '彭先生', phone: '13800138052', status: '正常上课中', gender: '女' }
        ]
    }
};
}

// Assign tempProgramData to window.programData (merge if it already exists)
if (window.programData && typeof window.programData === 'object' && tempProgramData !== window.programData) {
    // Merge new data into existing window.programData
    Object.assign(window.programData, tempProgramData);
    console.log('Merged new programData into window.programData');
} else if (!window.programData) {
    // No window.programData exists, so assign our tempProgramData to window
    window.programData = tempProgramData;
    console.log('Assigned programData to window.programData');
}

// Don't declare programData locally - use window.programData directly to avoid conflicts
// All references to programData in this file should use window.programData

// Helper functions to access student data
/**
 * Get student data by name
 * @param {string} name - Student name
 * @returns {Object|null} Student data object or null
 */
function getStudentByName(name) {
    return allStudentsData[name] || null;
}

/**
 * Get student data by student ID
 * @param {string} studentId - Student ID
 * @returns {Object|null} Student data object or null
 */
function getStudentById(studentId) {
    return Object.values(allStudentsData).find(student => student.studentId === studentId) || null;
}

/**
 * Get all students as an array
 * @returns {Array} Array of all student data objects
 */
function getAllStudents() {
    return Object.values(allStudentsData);
}

/**
 * Get students from students.html (for pagination)
 * @returns {Array} Array of student data objects
 */
function getStudentsForStudentsPage() {
    // Return first 60 students (students.html page)
    const allStudents = getAllStudents();
    return allStudents.slice(0, 60);
}

/**
 * Get program data
 * @param {string} programId - Program ID
 * @returns {Object|null} Program data object or null
 */
function getProgramData(programId) {
    return (window.programData && window.programData[programId]) || null;
}

/**
 * Get all program data
 * @returns {Object} All program data
 */
function getAllProgramData() {
    return window.programData || {};
}

// Build and expose student schedules globally
let studentSchedules;
try {
    studentSchedules = buildStudentSchedules();
    console.log('buildStudentSchedules completed, schedules count:', Object.keys(studentSchedules).length);
} catch (error) {
    console.error('Error building student schedules:', error);
    studentSchedules = {};
}

// Make data globally accessible
try {
    window.allStudentsData = allStudentsData;
    window.studentSchedules = studentSchedules;
    // window.programData is already set above (either from window or from tempProgramData)
    console.log('Data exposed to window successfully');
    console.log('window.studentSchedules keys:', Object.keys(window.studentSchedules || {}).slice(0, 5));
    console.log('window.allStudentsData keys:', Object.keys(window.allStudentsData || {}).slice(0, 5));
    console.log('window.programData keys:', Object.keys(window.programData || {}).slice(0, 5));
} catch (error) {
    console.error('Error exposing data to window:', error);
}

// Export helper functions
window.getStudentByName = getStudentByName;
window.getStudentById = getStudentById;
window.getAllStudents = getAllStudents;
window.getStudentsForStudentsPage = getStudentsForStudentsPage;
window.getProgramData = getProgramData;
window.getAllProgramData = getAllProgramData;

// Live roster fetcher for students.html
const STUDENT_API_BASE = 'http://localhost:8080';
async function fetchStudentsFromApi({ tenant, page = 1, pageSize = 10 }) {
    const params = new URLSearchParams({ tenant, limit: String(pageSize), offset: String((page - 1) * pageSize) });
    const resp = await fetch(`${STUDENT_API_BASE}/students?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}
window.fetchStudentsFromApi = fetchStudentsFromApi;
window.getStudentSchedule = getStudentSchedule;

