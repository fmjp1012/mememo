import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum AppTab: String, CaseIterable, Identifiable {
    case study = "学習"
    case packs = "パック"
    case stats = "進捗"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .study: "rectangle.and.pencil.and.ellipsis"
        case .packs: "square.grid.2x2"
        case .stats: "chart.bar"
        }
    }
}

struct QuizSessionState {
    var questions: [QuizQuestion] = []
    var index: Int = 0
    var selectedAnswer: Int?
    var isRevealed = false
    var isFinished = false
    var answers: [Bool] = []

    var currentQuestion: QuizQuestion? {
        questions.indices.contains(index) ? questions[index] : nil
    }

    var correctCount: Int {
        answers.filter { $0 }.count
    }
}

struct ContentView: View {
    @State private var store = StudyStore()
    @State private var activeTab: AppTab = .study

    var body: some View {
        TabView(selection: $activeTab) {
            StudyView(store: store)
                .tabItem { Label(AppTab.study.rawValue, systemImage: AppTab.study.systemImage) }
                .tag(AppTab.study)

            PacksView(store: store)
                .tabItem { Label(AppTab.packs.rawValue, systemImage: AppTab.packs.systemImage) }
                .tag(AppTab.packs)

            StatsView(store: store)
                .tabItem { Label(AppTab.stats.rawValue, systemImage: AppTab.stats.systemImage) }
                .tag(AppTab.stats)
        }
        .tint(.mememoGreen)
    }
}

struct StudyView: View {
    @Bindable var store: StudyStore
    @State private var session = QuizSessionState()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    PackStrip(store: store)
                    StudyControls(store: store, onStart: startQuiz)
                    QuizCard(
                        session: $session,
                        store: store,
                        onStart: startQuiz,
                        onAnswer: answer(_:),
                        onNext: nextQuestion
                    )
                }
                .padding(16)
            }
            .background(Color.mememoBackground)
            .navigationTitle("Mememo")
            .toolbar {
                Button("開始", action: startQuiz)
                    .fontWeight(.bold)
            }
            .onAppear {
                if session.questions.isEmpty {
                    startQuiz()
                    session.isRevealed = false
                }
            }
        }
    }

    private func startQuiz() {
        session = QuizSessionState(questions: store.buildQuiz())
    }

    private func answer(_ index: Int) {
        guard let question = session.currentQuestion, !session.isRevealed else { return }
        let isCorrect = index == question.answerIndex
        store.record(question, isCorrect: isCorrect)
        session.selectedAnswer = index
        session.isRevealed = true
        session.answers.append(isCorrect)
    }

    private func nextQuestion() {
        guard !session.questions.isEmpty else { return }
        if session.index == session.questions.count - 1 {
            store.finishSession(correct: session.correctCount, total: session.questions.count)
            session.isFinished = true
            return
        }
        session.index += 1
        session.selectedAnswer = nil
        session.isRevealed = false
    }
}

struct PackStrip: View {
    @Bindable var store: StudyStore

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(LearningData.packs) { pack in
                    Button {
                        store.togglePack(pack.id)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: pack.systemImage)
                            Text(pack.label)
                            if store.isPackEnabled(pack.id) {
                                Image(systemName: "checkmark")
                            }
                        }
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 12)
                        .frame(height: 38)
                        .background(store.isPackEnabled(pack.id) ? Color.mememoGreen.opacity(0.14) : Color.white)
                        .foregroundStyle(store.isPackEnabled(pack.id) ? Color.mememoGreenDark : Color.secondary)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(store.isPackEnabled(pack.id) ? Color.mememoGreen : Color.mememoBorder)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 1)
        }
    }
}

struct StudyControls: View {
    @Bindable var store: StudyStore
    let onStart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("モード", selection: $store.mode) {
                ForEach(StudyMode.allCases) { mode in
                    Label(mode.rawValue, systemImage: mode.systemImage).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Picker("試験回", selection: $store.selectedExamID) {
                ForEach(store.examOptions) { exam in
                    Text("\(exam.title)（\(exam.questionCount)問）").tag(exam.id)
                }
            }
            .pickerStyle(.menu)

            Stepper(value: $store.questionCount, in: 5...100, step: 5) {
                Text("出題数 \(store.questionCount)問")
                    .font(.subheadline.weight(.bold))
            }

            Button(action: onStart) {
                Label("選択条件で開始", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mememoBorder))
    }
}

struct QuizCard: View {
    @Binding var session: QuizSessionState
    @Bindable var store: StudyStore
    let onStart: () -> Void
    let onAnswer: (Int) -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if session.isFinished {
                ResultSummary(session: session, onStart: onStart)
            } else if let question = session.currentQuestion {
                QuestionContent(question: question, session: $session, store: store, onAnswer: onAnswer, onNext: onNext)
            } else {
                EmptyState(onStart: onStart)
            }
        }
        .padding(18)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mememoBorder))
    }
}

struct QuestionContent: View {
    let question: QuizQuestion
    @Binding var session: QuizSessionState
    @Bindable var store: StudyStore
    let onAnswer: (Int) -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(question.examTitle.map { "\(LearningData.pack(for: question.packID)?.label ?? question.packID) / \($0) / \(question.subject)" } ?? "\(LearningData.pack(for: question.packID)?.label ?? question.packID) / \(question.subject)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.mememoGreenDark)
                Spacer()
                Text("Q.\(session.index + 1)/\(session.questions.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }

            Text(question.source)
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)

            if question.transcriptionText.isEmpty {
                QuestionTranscription(text: question.prompt)
            } else {
                QuestionTranscription(text: question.transcriptionText)
            }

            if !question.imagePaths.isEmpty {
                DisclosureGroup("公式PDF画像を確認") {
                    VStack(spacing: 12) {
                        ForEach(question.imagePaths, id: \.self) { path in
                            QuestionPageImage(path: path, accessibilityLabel: "\(question.source)の公式問題ページ")
                        }
                    }
                }
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mememoBorder))
            }

            VStack(spacing: 10) {
                ForEach(question.choices.indices, id: \.self) { index in
                    Button {
                        onAnswer(index)
                    } label: {
                        HStack(spacing: 12) {
                            Text(choiceLabel(for: index))
                                .font(.caption.weight(.black))
                                .frame(width: 32, height: 28)
                                .background(Color.mememoGreen.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Text(question.choices[index])
                                .font(.body.weight(.semibold))
                                .multilineTextAlignment(.leading)
                            Spacer()
                            answerIcon(for: index)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(choiceBackground(for: index))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(choiceBorder(for: index)))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(session.isRevealed)
                }
            }

            Button {
                store.toggleBookmark(question.id)
            } label: {
                Label(store.bookmarks.contains(question.id) ? "保存済み" : "あとで復習", systemImage: store.bookmarks.contains(question.id) ? "bookmark.fill" : "bookmark")
            }
            .buttonStyle(.bordered)

            if session.isRevealed {
                VStack(alignment: .leading, spacing: 10) {
                    Text(session.selectedAnswer == question.answerIndex ? "正解です" : "復習対象です")
                        .font(.headline)
                    Text(question.explanation)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button(session.index == session.questions.count - 1 ? "結果を見る" : "次へ", action: onNext)
                        .buttonStyle(.borderedProminent)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(session.selectedAnswer == question.answerIndex ? Color.mememoGreen.opacity(0.1) : Color.red.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func choiceLabel(for index: Int) -> String {
        question.choiceLabels.indices.contains(index) ? question.choiceLabels[index] : String(index + 1)
    }

    @ViewBuilder
    private func answerIcon(for index: Int) -> some View {
        if session.isRevealed, index == question.answerIndex {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Color.mememoGreen)
        } else if session.isRevealed, index == session.selectedAnswer {
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
        }
    }

    private func choiceBackground(for index: Int) -> Color {
        guard session.isRevealed else { return Color.white }
        if index == question.answerIndex { return Color.mememoGreen.opacity(0.1) }
        if index == session.selectedAnswer { return Color.red.opacity(0.08) }
        return Color.white
    }

    private func choiceBorder(for index: Int) -> Color {
        guard session.isRevealed else { return Color.mememoBorder }
        if index == question.answerIndex { return Color.mememoGreen }
        if index == session.selectedAnswer { return Color.red.opacity(0.5) }
        return Color.mememoBorder
    }
}

struct QuestionTranscription: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("問題文")
                Spacer()
                Text("OCR文字起こし")
                    .foregroundStyle(.secondary)
            }
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.mememoGreenDark)
            Text(text)
                .font(.body)
                .lineSpacing(4)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(Color.mememoGreen.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mememoBorder))
    }
}

struct QuestionPageImage: View {
    let path: String
    let accessibilityLabel: String

    var body: some View {
        if let image = loadImage() {
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(minWidth: 720)
                    .accessibilityLabel(accessibilityLabel)
            }
            .frame(maxHeight: 560)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mememoBorder))
        }
    }

    private func loadImage() -> UIImage? {
        let nsPath = path as NSString
        let directory = nsPath.deletingLastPathComponent
        let filename = nsPath.lastPathComponent as NSString
        let name = filename.deletingPathExtension
        let ext = filename.pathExtension
        guard let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: directory) else {
            return nil
        }
        return UIImage(contentsOfFile: url.path)
    }
}

struct ResultSummary: View {
    let session: QuizSessionState
    let onStart: () -> Void

    private var rate: Int {
        session.questions.isEmpty ? 0 : Int((Double(session.correctCount) / Double(session.questions.count) * 100).rounded())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("\(rate)%", systemImage: "trophy")
                .font(.largeTitle.weight(.black))
                .foregroundStyle(Color.mememoGreenDark)
            Text("\(session.correctCount)/\(session.questions.count)問 正解")
                .font(.headline)
            Button("同条件で再挑戦", action: onStart)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct EmptyState: View {
    let onStart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "tray")
                .font(.title)
                .foregroundStyle(Color.mememoBlue)
            Text("この条件で出題できる問題がありません")
                .font(.headline)
            Button("ランダム学習を開始", action: onStart)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PacksView: View {
    @Bindable var store: StudyStore

    var body: some View {
        NavigationStack {
            List {
                ForEach(LearningData.packs) { pack in
                    let progress = store.progress(for: pack)
                    HStack(spacing: 12) {
                        Image(systemName: pack.systemImage)
                            .font(.title3)
                            .foregroundStyle(Color.mememoGreen)
                            .frame(width: 34)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(pack.title)
                                .font(.headline)
                            Text(pack.description)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text("\(progress.questionCount)問 / 正答率 \(progress.rate)%")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Color.mememoGreenDark)
                        }
                        Spacer()
                        Button {
                            store.togglePack(pack.id)
                        } label: {
                            Image(systemName: store.isPackEnabled(pack.id) ? "checkmark.circle.fill" : "circle")
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.vertical, 6)
                }
            }
            .navigationTitle("パック")
        }
    }
}

struct StatsView: View {
    @Bindable var store: StudyStore
    @State private var showingResetAlert = false

    var body: some View {
        NavigationStack {
            List {
                Section("サマリー") {
                    StatRow(label: "総演習", value: "\(store.summary.total)回")
                    StatRow(label: "正答率", value: "\(store.summary.rate)%")
                    StatRow(label: "定着済み", value: "\(store.summary.mastered)問")
                    Button(role: .destructive) {
                        showingResetAlert = true
                    } label: {
                        Label("ローカル進捗をリセット", systemImage: "arrow.counterclockwise")
                    }
                }

                Section("パック別") {
                    ForEach(LearningData.packs) { pack in
                        let progress = store.progress(for: pack)
                        StatRow(label: pack.label, value: "\(progress.rate)%")
                    }
                }

                Section("最近のセッション") {
                    if store.sessions.isEmpty {
                        Text("まだ記録はありません")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.sessions) { session in
                            StatRow(label: session.mode, value: "\(session.correct)/\(session.total)")
                        }
                    }
                }
            }
            .navigationTitle("進捗")
            .alert("ローカル進捗をリセットしますか？", isPresented: $showingResetAlert) {
                Button("キャンセル", role: .cancel) {}
                Button("リセット", role: .destructive) {
                    store.resetProgress()
                }
            } message: {
                Text("演習履歴、保存済み、セッション記録が削除されます。")
            }
        }
    }
}

struct StatRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .fontWeight(.bold)
        }
    }
}

extension Color {
    static let mememoBackground = Color(red: 0.965, green: 0.98, blue: 0.984)
    static let mememoBorder = Color(red: 0.86, green: 0.91, blue: 0.92)
    static let mememoGreen = Color(red: 0.0, green: 0.66, blue: 0.42)
    static let mememoGreenDark = Color(red: 0.03, green: 0.45, blue: 0.31)
    static let mememoBlue = Color(red: 0.12, green: 0.49, blue: 0.81)
}

#Preview {
    ContentView()
}
