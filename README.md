# WebRTC-test

## Use:

```bash
#安装依赖
npm install
#编辑并重命名配置文件
mv .env.example .env
#构建前端项目
npm run build
#运行peerjserver与前端项目
npm run start
```

## 演示

### 房主模式
直接访问url不带ID参数就是房主模式，会生成邀请链接供另一个人加入。点击采集流调用浏览器的分享功能采集音视频。

![image-20240130111722947](https://file.ahaly.cc:99/upload/test/image-20240130111722947.png)


### 加入模式

访问房主生成的URL，就是加入模式，点击接受流播放房主分享的音视频

![image-20240130111815105](https://file.ahaly.cc:99/upload/test/image-20240130111815105.png)


### WebRTC延时测试

> 在可以点对点链接的环境下采集延迟60ms，传输基本无延迟(<10ms)

* 宽带环境

![image-20240130112921099](https://file.ahaly.cc:99/upload/test/image-20240130112921099.png)

* 4g移动数据环境

![image-20240130112304027](https://file.ahaly.cc:99/upload/test/image-20240130112304027.png)

