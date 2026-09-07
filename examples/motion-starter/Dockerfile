# syntax=docker/dockerfile:1.7
#
# Sentinel Ops —— vaadin-motion 的演示应用镜像。
#
# 多阶段构建：
#   builder     - JDK 21 编译（先装 vaadin-motion 本体，再构建 example）
#   jre-builder - jlink 生成最小 JRE，仅含运行期需要的模块
#   runtime     - Alpine + 自定义 JRE + app.jar
#
# 构建上下文是仓库根目录，不是 examples/motion-starter/，因为 example 依赖
# 同仓库的 com.wontlost:motion-vaadin。用发布到 Central 的版本也可以，但那样
# 演示的就不是当前分支的代码了——demo 的意义正是展示这份源码的行为。

# ============================================================
# Stage 1: 构建应用
# ============================================================
# 用官方 maven 镜像而非 eclipse-temurin：后者不含 mvn，而本项目没有
# Maven wrapper（ckeditor-builder 用的是 Gradle wrapper，所以不受影响）。
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build

# 第一层：只复制 POM，让依赖解析结果能被缓存。源码改动不会使这层失效。
COPY pom.xml ./
COPY examples/motion-starter/pom.xml examples/motion-starter/

# 第二层：预热依赖。go-offline 在多模块场景下会因为找不到尚未安装的
# motion-vaadin 而失败，因此用 -fn（fail never）：这一步只为填充缓存，
# 真正的失败应该在下面的 install/package 阶段暴露出来。
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -B -ntp -fn dependency:go-offline

# 第三层：复制源码。前端 node_modules 由 .dockerignore 排除——Vaadin 会
# 在构建期自行安装，把宿主机的 node_modules 带进来只会拖慢构建并可能
# 混入平台相关的二进制。
COPY src/ src/
COPY examples/motion-starter/src/ examples/motion-starter/src/

# 先把 motion-vaadin 装进本地仓库，example 才能解析到它。
# 跳过测试：镜像构建不是跑测试的地方，CI 已经在更早的 job 里跑过。
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -B -ntp install -DskipTests

# 生产模式构建 example：vaadin-maven-plugin 的 build-frontend 会产出
# hashed bundle 并打进 jar，运行期不再需要 Node。
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -B -ntp -f examples/motion-starter/pom.xml package -Pproduction -DskipTests && \
    cp examples/motion-starter/target/*.jar /build/app.jar

# ============================================================
# Stage 2: jlink 自定义 JRE
#
# Spring Boot 与 Vaadin 大量依赖反射和 SPI，jdeps 推导不出完整集合，
# 因此这里取一个保守覆盖集。漏模块会在启动时以
# ClassNotFoundException / NoClassDefFoundError 暴露，可按需追加。
# 相比 ckeditor-builder 少了 java.sql.rowset / jdk.crypto.cryptoki /
# java.security.sasl 等——本应用不连数据库，也不用硬件加密模块。
# ============================================================
FROM eclipse-temurin:21-jdk-alpine AS jre-builder

RUN jlink \
    --add-modules java.base,java.compiler,java.desktop,java.instrument,java.logging,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.sql,java.transaction.xa,java.xml,java.xml.crypto,jdk.crypto.ec,jdk.jfr,jdk.management,jdk.naming.dns,jdk.net,jdk.security.auth,jdk.unsupported,jdk.zipfs,jdk.httpserver,jdk.localedata \
    --include-locales=en \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=zip-9 \
    --output /opt/jre

# ============================================================
# Stage 3: 运行时
# ============================================================
FROM alpine:3.20
WORKDIR /app

ENV JAVA_HOME=/opt/jre \
    PATH=/opt/jre/bin:${PATH} \
    LANG=en_US.UTF-8

# libstdc++ 是 musl 上运行 JVM 所需；tzdata 让日志时间戳不至于全是 UTC；
# curl 供 HEALTHCHECK 使用。
RUN apk add --no-cache tzdata libstdc++ curl && \
    addgroup -S appuser && \
    adduser -S -G appuser -h /app appuser && \
    chown -R appuser:appuser /app

COPY --from=jre-builder /opt/jre /opt/jre
COPY --from=builder --chown=appuser:appuser /build/app.jar app.jar

USER appuser

EXPOSE 8090

# 便于本地/非 K8s 场景；集群内仍以 deployment.yaml 的 probe 为准。
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8090/actuator/health/liveness || exit 1

# MaxRAMPercentage 而非固定 -Xmx：容器内存上限由 K8s limits 决定，
# 让 JVM 按实际配额自适应，避免上调 limit 后堆仍停在旧值。
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
