export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16 max-w-6xl">
        {/* Header Section */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            David's Soccer Training CRM
          </h1>
          <p className="text-xl text-gray-600 mb-8">Next.js + Tailwind CSS</p>

          <div className="flex gap-4 justify-center">
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg shadow-lg transition-all hover:shadow-xl">
              Get Started
            </button>
            <button className="bg-white hover:bg-gray-50 text-blue-600 font-semibold px-8 py-3 rounded-lg border-2 border-blue-600 transition-all">
              Learn More
            </button>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              Next.js 16
            </h2>
            <p className="text-gray-600">
              The latest version of Next.js with App Router, Server Components,
              and more.
            </p>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              Tailwind CSS
            </h2>
            <p className="text-gray-600">
              Utility-first CSS framework for beautiful, custom designs without
              leaving your HTML.
            </p>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              TypeScript
            </h2>
            <p className="text-gray-600">
              Type-safe development with excellent IDE support and fewer bugs.
            </p>
          </div>
        </div>

        {/* Test Section */}
        <div className="mt-12 bg-white rounded-xl p-8 shadow-lg">
          <h3 className="text-3xl font-bold text-gray-900 mb-4">
            Tailwind is Working! 🎉
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-green-500 rounded-full"></div>
              <span className="text-gray-700">Responsive Grid Layout</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
              <span className="text-gray-700">Gradient Background</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-purple-500 rounded-full"></div>
              <span className="text-gray-700">Hover Effects & Transitions</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-pink-500 rounded-full"></div>
              <span className="text-gray-700">Custom Shadows & Borders</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
